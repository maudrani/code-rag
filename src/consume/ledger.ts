import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import type { Engine } from '../contracts/engine.js'
import type { Consumer, Observable, QueryLogEntry } from '../contracts/telemetry.js'

/**
 * The cross-consumer ledger sink (observability design §5.3). Today each process holds
 * its OWN in-memory ledger (`engine.queryLog()`), so the dashboard — connected to the
 * HTTP server — can never see a query issued by an agent over MCP or the CLI, and
 * `code-rag log` standalone reads empty. This is the shared, cross-PROCESS half: each
 * consumer appends its `QueryLogEntry` to one append-only JSONL, and the HTTP server
 * (+ CLI) read it. Surface-owned, wired once in buildEngine — no membrane change.
 *
 * Adopts the append-only-JSONL + offset-tail pattern (skillsmp observe / orch-log).
 */

/** The write side — one line per query. */
export interface LedgerSink {
  append(entry: QueryLogEntry): void
}

/**
 * A JSONL file sink. One `JSON.stringify(entry)\n` per append: a single line is well
 * under PIPE_BUF, so an O_APPEND write is atomic across processes — concurrent CLI/MCP/HTTP
 * writers interleave cleanly, no torn lines.
 */
export class JsonlLedgerSink implements LedgerSink {
  constructor(private readonly path: string) {}
  append(entry: QueryLogEntry): void {
    appendFileSync(this.path, `${JSON.stringify(entry)}\n`)
  }
}

/**
 * Read the shared ledger — tolerant of a partial/blank/malformed trailing line (a write
 * may be mid-flight). Newest-first; `consumer`/`limit` filters mirror `Observable.queryLog`.
 * Returns [] when the file does not exist yet.
 */
export function readLedger(
  path: string,
  opts?: { consumer?: Consumer; limit?: number },
): QueryLogEntry[] {
  if (!existsSync(path)) return []
  const entries: QueryLogEntry[] = []
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    try {
      entries.push(JSON.parse(trimmed) as QueryLogEntry)
    } catch {
      // skip a partial/malformed line — never throw on a mid-flight append
    }
  }
  let out = entries.reverse() // newest-first
  if (opts?.consumer !== undefined) out = out.filter((e) => e.consumer === opts.consumer)
  if (opts?.limit !== undefined) out = out.slice(0, opts.limit)
  return out
}

/**
 * withLedger — the write wiring, as an engine decorator (no membrane edit). Wraps
 * `query()`: after the inner membrane records the entry, find IT by `queryId` (never
 * "newest" — race-safe under concurrent queries) and append it to the sink. Everything
 * else (events, in-memory ledger, answer/on/telemetry) passes straight through.
 */
export function withLedger(engine: Engine & Observable, sink: LedgerSink): Engine & Observable {
  const query: Engine['query'] = async (question, history, intent) => {
    const projection = await engine.query(question, history, intent)
    const entry = engine.queryLog().find((e) => e.queryId === projection.queryId)
    if (entry) sink.append(entry)
    return projection
  }
  return { ...engine, query }
}

/** The shared-ledger path from the environment (`CODE_RAG_LEDGER`); undefined = not configured. */
export function resolveLedgerPath(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const path = env.CODE_RAG_LEDGER
  return path !== undefined && path.trim() !== '' ? path : undefined
}
