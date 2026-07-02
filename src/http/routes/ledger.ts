import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { streamSSE } from 'hono/streaming'
import { isConsumer, readLedger, readLedgerLines } from '../../consume/index.js'
import type { Consumer } from '../../contracts/telemetry.js'

/** how many recent entries a new /ledger/stream subscriber replays before tailing live. */
const REPLAY_CAP = 50
/** how often the tail polls the shared file for new appends (ms). */
const DEFAULT_TAIL_MS = 500

/**
 * The cross-consumer ledger surfaces (observability design §5.4) — the HTTP face of the
 * SHARED JSONL ledger every consumer appends to (src/consume/ledger.ts, wired in buildEngine).
 * Unlike per-process `/log` (in-memory, this server only), these read the shared file, so the
 * dashboard sees queries from EVERY consumer (an agent on MCP, the CLI, the web) — live.
 *
 * The path is injected (DI): undefined = no shared ledger configured -> graceful empty.
 */
export function ledgerRoutes(
  ledgerPath: string | undefined,
  tailIntervalMs: number = DEFAULT_TAIL_MS,
): Hono {
  const app = new Hono()

  // GET /ledger?consumer=&limit= — cross-process snapshot, newest-first, as { entries }.
  app.get('/ledger', (c) => {
    if (ledgerPath === undefined) return c.json({ entries: [] })
    const opts: { consumer?: Consumer; limit?: number } = {}
    const consumer = c.req.query('consumer')
    if (consumer !== undefined) {
      if (!isConsumer(consumer)) {
        throw new HTTPException(400, { message: `invalid consumer '${consumer}'` })
      }
      opts.consumer = consumer
    }
    const limit = c.req.query('limit')
    if (limit !== undefined) {
      const n = Number(limit)
      if (!Number.isInteger(n) || n <= 0) {
        throw new HTTPException(400, { message: `invalid limit '${limit}'` })
      }
      opts.limit = n
    }
    return c.json({ entries: readLedger(ledgerPath, opts) })
  })

  // GET /ledger/stream — SSE: replay the recent entries, then tail new appends live (the
  // frontend funnel). Race-free re-entrancy guard; the poll interval is torn down on abort.
  app.get('/ledger/stream', (c) => {
    return streamSSE(c, async (stream) => {
      let emitted = -1 // sentinel: first flush only replays the last REPLAY_CAP
      let flushing = false
      const flush = async (): Promise<void> => {
        if (ledgerPath === undefined || flushing) return
        flushing = true
        try {
          // Each new RAW line (append-only, so the index-tail sees them all) re-emits its queryId's
          // RECONCILED entry (retrieve ⊕ any L5 outcome, FTR-3 P2) as the authoritative wire
          // event:'entry' / data:QueryLogEntry (TKT-519): the retrieve line emits the entry, the later
          // outcome line re-emits it ENRICHED (answered/tokens/estCost) — the Live listener upserts by
          // queryId. readLedger is the SAME reconcile GET /ledger + `code-rag log` use (one SSOT).
          const lines = readLedgerLines(ledgerPath)
          const merged = new Map(readLedger(ledgerPath).map((e) => [e.queryId, e]))
          if (emitted === -1) emitted = Math.max(0, lines.length - REPLAY_CAP)
          for (let i = emitted; i < lines.length; i++) {
            const line = lines[i]
            if (line === undefined) continue
            const queryId = line.kind === 'entry' ? line.entry.queryId : line.outcome.queryId
            const entry = merged.get(queryId)
            if (entry !== undefined) {
              await stream.writeSSE({ event: 'entry', data: JSON.stringify(entry) })
            }
          }
          emitted = lines.length
        } finally {
          flushing = false
        }
      }

      await flush() // replay-on-connect
      await new Promise<void>((resolve) => {
        const timer = setInterval(() => {
          if (stream.aborted) {
            clearInterval(timer) // no dangling timer on disconnect
            resolve()
            return
          }
          void flush()
        }, tailIntervalMs)
      })
    })
  })

  return app
}
