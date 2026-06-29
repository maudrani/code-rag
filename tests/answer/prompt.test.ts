import { describe, expect, it } from 'vitest'
import { CITE_INSTRUCTION, SYSTEM_ANSWER_ONLY } from '../../src/answer/guardrails.js'
import { buildPrompt, HISTORY_WINDOW_TURNS, windowHistory } from '../../src/answer/prompt.js'
import type { Citation, Projection, Turn } from '../../src/contracts/index.js'

// ── fixtures ────────────────────────────────────────────────────────────────
function cite(chunkId: string): Citation {
  const path = chunkId.split('#')[0] ?? 'a.ts'
  return { chunkId, path, span: { startLine: 1, endLine: 3 }, label: chunkId }
}

function projection(overrides: Partial<Projection> = {}): Projection {
  return {
    queryId: 'q1',
    question: 'raw anaphoric question',
    resolvedQuery: 'RESOLVED standalone query',
    results: [],
    citations: [cite('a.ts#foo@1-3'), cite('b.ts#bar@4-9')],
    context: { assembled: 'CTX-ASSEMBLED-CODE-BLOCK', tokensEst: 42 },
    decision: { groundingScore: 0.5, band: 'answer', tier: 'cheap', model: 'claude-haiku-4-5' },
    ...overrides,
  }
}

function turn(role: Turn['role'], content: string): Turn {
  return { role, content }
}

// N alternating turns starting with 'user': u0, a1, u2, a3, ...
function altHistory(n: number): Turn[] {
  return Array.from({ length: n }, (_, i) => turn(i % 2 === 0 ? 'user' : 'assistant', `t${i}`))
}

// ── system message composition (SC-6) ────────────────────────────────────────
describe('buildPrompt — system message', () => {
  it('embeds the answer-only-from-context policy (TKT-303, single source)', () => {
    expect(buildPrompt(projection(), []).system).toContain(SYSTEM_ANSWER_ONLY)
  })

  it('embeds the assembled code context (the mise en place from the membrane)', () => {
    expect(buildPrompt(projection(), []).system).toContain('CTX-ASSEMBLED-CODE-BLOCK')
  })

  it('embeds the cite-every-claim instruction (TKT-303, single source)', () => {
    expect(buildPrompt(projection(), []).system).toContain(CITE_INSTRUCTION)
  })

  it('grounds the cite instruction in the EXACT citable id set from projection.citations', () => {
    const { system } = buildPrompt(projection(), [])
    expect(system).toContain('[a.ts#foo@1-3]')
    expect(system).toContain('[b.ts#bar@4-9]')
  })

  it('empty citations -> still a valid system message (policy + instruction), no citable-id list, no throw', () => {
    const { system } = buildPrompt(projection({ citations: [] }), [])
    expect(system).toContain(SYSTEM_ANSWER_ONLY)
    expect(system).toContain(CITE_INSTRUCTION)
    expect(system).not.toContain('[a.ts#foo@1-3]')
  })

  it('empty context.assembled -> system still carries the answer-only policy (model will decline)', () => {
    const { system } = buildPrompt(projection({ context: { assembled: '', tokensEst: 0 } }), [])
    expect(system).toContain(SYSTEM_ANSWER_ONLY)
  })
})

// ── messages: history window + final user turn (SC-6) ─────────────────────────
describe('buildPrompt — messages', () => {
  it('empty history -> messages is exactly the single current user turn (resolvedQuery)', () => {
    const { messages } = buildPrompt(projection(), [])
    expect(messages).toEqual([{ role: 'user', content: 'RESOLVED standalone query' }])
  })

  it('the FINAL message is always the current user turn carrying resolvedQuery (not the raw question)', () => {
    const { messages } = buildPrompt(projection(), altHistory(3))
    const last = messages[messages.length - 1]
    expect(last).toEqual({ role: 'user', content: 'RESOLVED standalone query' })
    expect(last?.content).not.toBe('raw anaphoric question')
  })

  it('history shorter than the window -> all prior turns kept, in order, then the final user turn', () => {
    const { messages } = buildPrompt(projection(), [turn('user', 'q1'), turn('assistant', 'a1')])
    expect(messages).toEqual([
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'RESOLVED standalone query' },
    ])
  })

  it('history longer than the window -> only the last HISTORY_WINDOW_TURNS prior turns + the final user turn', () => {
    const { messages } = buildPrompt(projection(), altHistory(HISTORY_WINDOW_TURNS + 4))
    // windowed history + 1 final user turn
    expect(messages).toHaveLength(HISTORY_WINDOW_TURNS + 1)
    // the kept history is the TAIL (most recent), preserving order
    const keptContents = messages.slice(0, -1).map((m) => m.content)
    expect(keptContents[0]).toBe(`t${4}`) // first of the last-6 of a 10-turn history
    expect(keptContents).toEqual(['t4', 't5', 't6', 't7', 't8', 't9'])
  })
})

// ── windowHistory helper (reused by TKT-306 rewrite) ──────────────────────────
describe('windowHistory', () => {
  it('returns at most HISTORY_WINDOW_TURNS turns', () => {
    expect(windowHistory(altHistory(20))).toHaveLength(HISTORY_WINDOW_TURNS)
  })

  it('keeps the LAST turns (recency), preserving order', () => {
    const w = windowHistory(altHistory(HISTORY_WINDOW_TURNS + 4))
    expect(w.map((t) => t.content)).toEqual(['t4', 't5', 't6', 't7', 't8', 't9'])
  })

  it('trims a single leading assistant turn so the window starts with a user turn', () => {
    expect(windowHistory([turn('assistant', 'A'), turn('user', 'B')])).toEqual([
      { role: 'user', content: 'B' },
    ])
  })

  it('empty history -> []', () => {
    expect(windowHistory([])).toEqual([])
  })
})

// ── purity / negatives (for every success, a failure) ─────────────────────────
describe('buildPrompt — purity & negatives', () => {
  it('MUST NOT include more than HISTORY_WINDOW_TURNS prior turns', () => {
    const { messages } = buildPrompt(projection(), altHistory(50))
    expect(messages.length - 1).toBeLessThanOrEqual(HISTORY_WINDOW_TURNS)
  })

  it('MUST NOT use the raw anaphoric question as the final turn when resolvedQuery differs', () => {
    const { messages } = buildPrompt(
      projection({ question: 'where is that?', resolvedQuery: 'where is auth defined?' }),
      [],
    )
    expect(messages[messages.length - 1]?.content).toBe('where is auth defined?')
  })

  it('MUST NOT mutate the input history array (pure)', () => {
    const history = altHistory(HISTORY_WINDOW_TURNS + 3)
    const snapshot = history.map((t) => ({ ...t }))
    buildPrompt(projection(), history)
    expect(history).toEqual(snapshot)
  })

  it('MUST NOT throw on empty history or empty context.assembled', () => {
    expect(() =>
      buildPrompt(projection({ context: { assembled: '', tokensEst: 0 } }), []),
    ).not.toThrow()
  })
})
