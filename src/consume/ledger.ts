import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
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

/**
 * The L5 outcome line (FTR-3 P2): a partial ledger record appended when answer() completes and
 * reconciled onto the retrieve line by queryId. Two lines because JSONL is append-only + cross-
 * process (you cannot rewrite the retrieve line in place) — so append + reconcile-on-read.
 */
export interface LedgerOutcome {
  queryId: string
  answered: boolean
  tokens?: number
  estCost?: number
}

/** The write side: the retrieve line (append) + the L5 outcome line (appendOutcome), by queryId. */
export interface LedgerSink {
  append(entry: QueryLogEntry): void
  appendOutcome(outcome: LedgerOutcome): void
}

/** A raw ledger line in APPEND order (NOT reconciled) — the SSE tail's per-line source. */
export type LedgerLine =
  | { kind: 'entry'; entry: QueryLogEntry }
  | { kind: 'outcome'; outcome: LedgerOutcome }

/**
 * A JSONL file sink. One `JSON.stringify(entry)\n` per append: a single line is well
 * under PIPE_BUF, so an O_APPEND write is atomic across processes — concurrent CLI/MCP/HTTP
 * writers interleave cleanly, no torn lines.
 */
export class JsonlLedgerSink implements LedgerSink {
  // A per-process nonce so a query's SHARED-ledger id is GLOBALLY unique. A fresh CLI process resets its
  // in-process queryId to `q1`, so without this every terminal `code-rag ask` collides on `q1` in the
  // shared file — the dashboard dedupes them by queryId, so only one ever shows. pid + a monotonic
  // hrtime is unique per process invocation (and is neither Date.now nor Math.random — determinism-guard
  // safe). A retrieve line and its outcome line share the nonce, so they still reconcile within a process.
  private readonly nonce = `${process.pid}-${process.hrtime.bigint().toString(36)}`
  constructor(private readonly path: string) {}
  append(entry: QueryLogEntry): void {
    const queryId = `${this.nonce}:${entry.queryId}`
    appendFileSync(this.path, `${JSON.stringify({ ...entry, queryId })}\n`)
  }
  appendOutcome(outcome: LedgerOutcome): void {
    const queryId = `${this.nonce}:${outcome.queryId}`
    appendFileSync(this.path, `${JSON.stringify({ ...outcome, queryId })}\n`)
  }
}

/** A retrieve line carries the full entry (numeric `ts`); an outcome line has a boolean `answered`
 *  and no `ts`. These structural guards classify each raw line (no marker field needed). */
function isRetrieveLine(o: unknown): o is QueryLogEntry {
  return (
    typeof o === 'object' &&
    o !== null &&
    typeof (o as QueryLogEntry).queryId === 'string' &&
    typeof (o as QueryLogEntry).ts === 'number'
  )
}
function isOutcomeLine(o: unknown): o is LedgerOutcome {
  return (
    typeof o === 'object' &&
    o !== null &&
    typeof (o as LedgerOutcome).queryId === 'string' &&
    typeof (o as { ts?: unknown }).ts !== 'number' &&
    typeof (o as LedgerOutcome).answered === 'boolean'
  )
}

/**
 * readLedgerLines — every ledger line in APPEND order, classified entry|outcome, tolerant of a
 * blank/partial/malformed line (a mid-flight append never throws). This is the raw feed the SSE
 * tail emits per-line (event:entry / event:outcome); readLedger reconciles it.
 */
export function readLedgerLines(path: string): LedgerLine[] {
  if (!existsSync(path)) return []
  const lines: LedgerLine[] = []
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = raw.trim()
    if (trimmed === '') continue
    let obj: unknown
    try {
      obj = JSON.parse(trimmed)
    } catch {
      continue // skip a partial/malformed line
    }
    if (isOutcomeLine(obj)) lines.push({ kind: 'outcome', outcome: obj })
    else if (isRetrieveLine(obj)) lines.push({ kind: 'entry', entry: obj })
    // else: an unrecognized JSON object — skip
  }
  return lines
}

/**
 * Read the shared ledger, RECONCILED (FTR-3 P2): a retrieve line + its optional L5 outcome line
 * (appended when answer() completed) merge into one complete entry by queryId. Newest-first;
 * `consumer`/`limit` filters mirror `Observable.queryLog`. Returns [] when the file does not exist.
 * An orphan outcome (no retrieve line) is dropped — it cannot reconstruct a full entry.
 */
export function readLedger(
  path: string,
  opts?: { consumer?: Consumer; limit?: number },
): QueryLogEntry[] {
  const byId = new Map<string, QueryLogEntry>()
  const order: string[] = [] // first-seen (retrieve) order → newest-first on reverse
  for (const line of readLedgerLines(path)) {
    if (line.kind === 'entry') {
      if (!byId.has(line.entry.queryId)) order.push(line.entry.queryId)
      byId.set(line.entry.queryId, { ...line.entry })
    } else {
      const base = byId.get(line.outcome.queryId)
      if (base === undefined) continue // orphan outcome — no retrieve line to merge onto
      base.answered = line.outcome.answered
      if (line.outcome.tokens !== undefined) base.tokens = line.outcome.tokens
      if (line.outcome.estCost !== undefined) base.estCost = line.outcome.estCost
    }
  }
  let out = order.map((id) => byId.get(id) as QueryLogEntry).reverse() // newest-first
  if (opts?.consumer !== undefined) out = out.filter((e) => e.consumer === opts.consumer)
  if (opts?.limit !== undefined) out = out.slice(0, opts.limit)
  return out
}

/**
 * clearLedger — truncate the shared JSONL to empty (a fresh observability session). Append-only means
 * a running /ledger/stream tail simply resets its offset on the next poll (lines.length < emitted), and
 * a reconnect replays nothing — so the reset SURVIVES a browser refresh (unlike clearing only the client
 * feed). A no-op if the file does not exist yet. NEVER throws on a benign fs race.
 */
export function clearLedger(path: string): void {
  try {
    if (existsSync(path)) writeFileSync(path, '')
  } catch {
    // a concurrent writer/racing unlink must not crash the clear — the next append recreates the file
  }
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
  // Wrap answer(): when the L5 stream completes, the membrane has joined the outcome onto its entry
  // (read-time, FTR-3 P2). Append it as the 2nd line so the SHARED ledger shows the complete history —
  // the retrieve line was written at query-time, BEFORE the answer ran. Refuse/search never call
  // answer(), so they get no 2nd line (a refuse is already complete — joined in query(); a search has
  // no L5 outcome). Transparent to the stream (same chunks, same order); the append is a post-completion
  // side-effect, so a consumer that breaks early (client disconnect) simply gets no outcome line.
  const answer: Engine['answer'] = async function* (projection, history) {
    yield* engine.answer(projection, history)
    const entry = engine.queryLog().find((e) => e.queryId === projection.queryId)
    if (entry?.answered !== undefined) {
      const outcome: LedgerOutcome = { queryId: entry.queryId, answered: entry.answered }
      if (entry.tokens !== undefined) outcome.tokens = entry.tokens
      if (entry.estCost !== undefined) outcome.estCost = entry.estCost
      sink.appendOutcome(outcome)
    }
  }
  return { ...engine, query, answer }
}

/** The shared-ledger path from the environment (`CODE_RAG_LEDGER`); undefined = not configured. */
export function resolveLedgerPath(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const path = env.CODE_RAG_LEDGER
  return path !== undefined && path.trim() !== '' ? path : undefined
}
