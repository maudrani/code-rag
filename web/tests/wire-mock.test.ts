import { describe, expect, it } from 'vitest'
import {
  ANSWER_TEXT,
  answerProjection,
  FOREIGN_QUERY_ID,
  refuseProjection,
  traceEventsFixture,
} from '../src/mocks/fixtures'
import {
  looksLikeRepoUrl,
  makeIngestResponse,
  makeQueryStream,
  makeSearchResponse,
  makeTraceEvents,
  tokenize,
} from '../src/mocks/wireMock'

describe('makeQueryStream — ADR-008 ordering invariant', () => {
  it('answer band: meta first, then token(s), done last', () => {
    const stream = makeQueryStream(answerProjection, { answer: ANSWER_TEXT })
    expect(stream[0]?.event).toBe('meta')
    expect(stream.at(-1)?.event).toBe('done')
    const firstToken = stream.findIndex((e) => e.event === 'token')
    const lastToken = stream.map((e) => e.event).lastIndexOf('token')
    expect(firstToken).toBeGreaterThan(0) // never before meta
    expect(lastToken).toBeLessThan(stream.length - 1) // never after done
    expect(stream.filter((e) => e.event === 'token').length).toBeGreaterThan(0)
  })

  it('refuse band: EXACTLY [meta, done] with ZERO token events', () => {
    const stream = makeQueryStream(refuseProjection, { answer: 'this answer must be ignored' })
    expect(stream.map((e) => e.event)).toEqual(['meta', 'done'])
    expect(stream.some((e) => e.event === 'token')).toBe(false)
  })

  it('done.tokensTotal equals the number of token events', () => {
    const stream = makeQueryStream(answerProjection, { answer: ANSWER_TEXT })
    const tokenCount = stream.filter((e) => e.event === 'token').length
    const done = stream.at(-1)
    expect(done?.event).toBe('done')
    if (done?.event === 'done') {
      expect(done.data.tokensTotal).toBe(tokenCount)
      expect(done.data.estCost).toBeGreaterThanOrEqual(0)
    }
  })

  it('meta carries the projection (citations + decision) unchanged', () => {
    const [meta] = makeQueryStream(answerProjection, { answer: ANSWER_TEXT })
    expect(meta?.event).toBe('meta')
    if (meta?.event === 'meta') {
      expect(meta.data.queryId).toBe(answerProjection.queryId)
      expect(meta.data.decision.band).toBe('answer')
      expect(meta.data.citations.length).toBeGreaterThan(0)
    }
  })
})

describe('makeTraceEvents — queryId tagging (SC-03 support)', () => {
  it('tags every Event with the given queryId', () => {
    const events = makeTraceEvents('q-tag')
    expect(events.length).toBeGreaterThan(0)
    expect(events.every((e) => e.queryId === 'q-tag')).toBe(true)
  })

  it('covers the pipeline layers L0..L5 + membrane', () => {
    const layers = new Set(makeTraceEvents('q').map((e) => e.layer))
    for (const l of ['L0', 'L4', 'membrane', 'L5'] as const) {
      expect(layers.has(l)).toBe(true)
    }
  })

  it('the trace fixture deliberately includes a foreign queryId (filter negative case)', () => {
    expect(traceEventsFixture.some((e) => e.queryId === FOREIGN_QUERY_ID)).toBe(true)
    expect(traceEventsFixture.some((e) => e.queryId !== FOREIGN_QUERY_ID)).toBe(true)
  })
})

describe('makeSearchResponse — deterministic, no answer', () => {
  it('returns a projection (results + decision) and never an answer field', () => {
    const res = makeSearchResponse(answerProjection)
    expect(Array.isArray(res.results)).toBe(true)
    expect(res.decision).toBeDefined()
    expect('answer' in res).toBe(false)
  })
})

describe('makeIngestResponse + looksLikeRepoUrl — POST /ingest mock (TKT-533)', () => {
  it('accepts allowlisted git URLs and returns a deterministic {activeCorpus, ingestReport}', () => {
    for (const url of [
      'https://github.com/foo/bar',
      'https://github.com/foo/bar.git',
      'git@github.com:foo/bar.git',
      'ssh://git@host/foo/bar',
    ]) {
      expect(looksLikeRepoUrl(url), url).toBe(true)
    }
    const res = makeIngestResponse('https://github.com/foo/bar.git')
    expect(res.activeCorpus.url).toBe('https://github.com/foo/bar.git')
    expect(res.ingestReport.filesIndexed).toBeGreaterThan(0)
    expect(res.ingestReport.chunks).toBeGreaterThan(0)
    // deterministic: same URL → same numbers (no I/O, no clock)
    expect(makeIngestResponse('https://github.com/foo/bar.git')).toEqual(res)
  })

  it('REJECTS a local path / unsafe URL (the /ingest 400 guard — no server-path indexing)', () => {
    for (const bad of ['/etc/passwd', './repo', 'file:///etc', 'https://h/x; rm -rf /', '']) {
      expect(looksLikeRepoUrl(bad), bad).toBe(false)
    }
  })
})

describe('tokenize', () => {
  it('returns [] for empty input', () => {
    expect(tokenize('')).toEqual([])
  })
  it('splits into chunks that rejoin to the original text', () => {
    expect(tokenize('hello world foo').join('')).toBe('hello world foo')
  })
})
