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
})
