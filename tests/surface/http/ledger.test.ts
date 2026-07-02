import { appendFileSync, mkdtempSync, rmSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Consumer, QueryLogEntry } from '../../../src/contracts/telemetry.js'
import { buildApp } from '../../../src/http/app.js'
import { ledgerRoutes } from '../../../src/http/routes/ledger.js'
import { makeMockEngine } from '../fixtures/mock-engine.js'

function entry(queryId: string, consumer: Consumer = 'cli'): QueryLogEntry {
  return {
    ts: 1,
    queryId,
    consumer,
    query: queryId,
    resultCount: 0,
    scoresByLeg: { bm25: 0, dense: 0, structural: 0 },
    band: 'answer',
    latencyMs: 1,
  }
}
function seed(file: string, ...entries: QueryLogEntry[]): void {
  for (const e of entries) appendFileSync(file, `${JSON.stringify(e)}\n`)
}

/** Read SSE frames off a stream until `count` `data:` payloads are collected. */
async function collectEntries(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  count: number,
): Promise<QueryLogEntry[]> {
  const decoder = new TextDecoder()
  let buf = ''
  const out: QueryLogEntry[] = []
  while (out.length < count) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let boundary = buf.indexOf('\n\n')
    while (boundary !== -1) {
      const frame = buf.slice(0, boundary)
      buf = buf.slice(boundary + 2)
      for (const line of frame.split('\n')) {
        if (line.startsWith('data:')) out.push(JSON.parse(line.slice(5).trim()) as QueryLogEntry)
      }
      boundary = buf.indexOf('\n\n')
    }
  }
  return out
}

/** Read SSE frames as {event,data} until `count` are collected (captures the event NAME). */
async function collectFrames(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  count: number,
): Promise<Array<{ event: string; data: string }>> {
  const decoder = new TextDecoder()
  let buf = ''
  const out: Array<{ event: string; data: string }> = []
  while (out.length < count) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let boundary = buf.indexOf('\n\n')
    while (boundary !== -1) {
      const frame = buf.slice(0, boundary)
      buf = buf.slice(boundary + 2)
      let event = 'message'
      let data = ''
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice('event:'.length).trim()
        else if (line.startsWith('data:')) data = line.slice('data:'.length).trim()
      }
      if (data) out.push({ event, data })
      boundary = buf.indexOf('\n\n')
    }
  }
  return out
}

/** An L5 outcome JSONL line (the 2nd line joined by queryId, FTR-3 P2). */
function seedOutcome(file: string, queryId: string): void {
  appendFileSync(
    file,
    `${JSON.stringify({ queryId, answered: true, tokens: 9, estCost: 0.004 })}\n`,
  )
}

let dir: string
let file: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ledger-http-'))
  file = join(dir, 'ledger.jsonl')
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('GET /ledger — cross-process snapshot (TKT-427)', () => {
  it('reads the shared file as { entries }, newest-first', async () => {
    seed(file, entry('q1', 'cli'), entry('q2', 'mcp'))
    const app = new Hono()
    app.route('/', ledgerRoutes(file))
    const res = await app.request('/ledger')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { entries: QueryLogEntry[] }
    expect(body.entries.map((e) => e.queryId)).toEqual(['q2', 'q1'])
  })

  it('consumer + limit filters', async () => {
    seed(file, entry('q1', 'cli'), entry('q2', 'mcp'), entry('q3', 'mcp'))
    const app = new Hono()
    app.route('/', ledgerRoutes(file))
    const res = await app.request('/ledger?consumer=mcp&limit=1')
    expect(
      ((await res.json()) as { entries: QueryLogEntry[] }).entries.map((e) => e.queryId),
    ).toEqual(['q3'])
  })

  it('GRACEFUL: no ledger configured -> 200 { entries: [] } (not 500)', async () => {
    const app = new Hono()
    app.route('/', ledgerRoutes(undefined))
    const res = await app.request('/ledger')
    expect(res.status).toBe(200)
    expect(((await res.json()) as { entries: QueryLogEntry[] }).entries).toEqual([])
  })

  it('cross-origin: ACAO present via buildApp (the browser reads it)', async () => {
    seed(file, entry('q1'))
    const { app } = buildApp(makeMockEngine(), file)
    const res = await app.request('/ledger', { headers: { Origin: 'http://localhost:5173' } })
    expect(res.headers.get('access-control-allow-origin')).not.toBeNull()
  })

  it('reconciles the L5 outcome (2nd line) onto the entry — ONE complete row (FTR-3 P2, TKT-434)', async () => {
    seed(file, entry('q1')) // retrieve line
    seedOutcome(file, 'q1') // the L5 outcome line, joined by queryId
    const app = new Hono()
    app.route('/', ledgerRoutes(file))
    const body = (await (await app.request('/ledger')).json()) as { entries: QueryLogEntry[] }
    expect(body.entries).toHaveLength(1) // ONE reconciled entry, not two rows
    expect(body.entries[0]?.answered).toBe(true)
    expect(body.entries[0]?.tokens).toBe(9)
    expect(body.entries[0]?.estCost).toBe(0.004)
  })
})

describe('GET /ledger/stream — SSE tail (TKT-427)', () => {
  it('replays existing entries, then emits a newly-appended one LIVE', async () => {
    seed(file, entry('q1'))
    const app = new Hono()
    app.route('/', ledgerRoutes(file, 20)) // fast poll for the test
    const server = serve({ fetch: app.fetch, port: 0 })
    try {
      const port = (server.address() as AddressInfo).port
      const ac = new AbortController()
      const res = await fetch(`http://127.0.0.1:${port}/ledger/stream`, { signal: ac.signal })
      const reader = (res.body as ReadableStream<Uint8Array>).getReader()

      const replayed = await collectEntries(reader, 1)
      expect(replayed[0]?.queryId).toBe('q1') // replay-on-connect

      seed(file, entry('q2', 'mcp')) // a DIFFERENT consumer appends (cross-process)
      const tailed = await collectEntries(reader, 1)
      expect(tailed[0]?.queryId).toBe('q2') // tailed live
      expect(tailed[0]?.consumer).toBe('mcp')

      ac.abort() // closes the connection -> stream.aborted -> the poll interval is cleared
    } finally {
      server.close()
    }
  }, 10000)

  it('re-emits the ENRICHED entry (event:entry) when the L5 outcome joins by queryId (FTR-3 P2)', async () => {
    seed(file, entry('q1'))
    const app = new Hono()
    app.route('/', ledgerRoutes(file, 20))
    const server = serve({ fetch: app.fetch, port: 0 })
    try {
      const port = (server.address() as AddressInfo).port
      const ac = new AbortController()
      const res = await fetch(`http://127.0.0.1:${port}/ledger/stream`, { signal: ac.signal })
      const reader = (res.body as ReadableStream<Uint8Array>).getReader()

      const [first] = await collectFrames(reader, 1)
      expect(first?.event).toBe('entry') // the retrieve line → event:entry, not yet enriched
      expect((JSON.parse(first?.data ?? '{}') as { answered?: boolean }).answered).toBeUndefined()

      seedOutcome(file, 'q1') // the L5 outcome appends as the 2nd line (cross-process)
      const [second] = await collectFrames(reader, 1)
      expect(second?.event).toBe('entry') // authoritative wire: event:entry / data:QueryLogEntry (TKT-519)
      const enriched = JSON.parse(second?.data ?? '{}') as {
        queryId: string
        answered: boolean
        tokens: number
      }
      expect(enriched.queryId).toBe('q1') // same row — the Live listener upserts by queryId
      expect(enriched.answered).toBe(true) // now enriched with the L5 outcome
      expect(enriched.tokens).toBe(9)

      ac.abort()
    } finally {
      server.close()
    }
  }, 10000)
})
