import type { Context } from 'hono'
import { isConsumer } from '../consume/index.js'
import type { Consumer } from '../contracts/telemetry.js'

/**
 * resolveConsumer — the client-declared consumer tag for a /query or /search request, so the
 * standalone web UI (a browser on :5173) is recorded as 'web' in the cross-consumer ledger
 * instead of the transport default 'http'. Precedence: the `X-Consumer` header, then the
 * `?consumer=` query param, validated against the Consumer union (isConsumer).
 *
 * An absent OR unrecognized value falls back to 'http': the tag is telemetry metadata, not part
 * of answering, so a bad tag must never fail the query. (Contrast the /log READ surface, which
 * 400s on a bad `?consumer=` FILTER — there the value selects what you get back; here it only
 * labels who asked, so the write path degrades gracefully.)
 */
export function resolveConsumer(c: Context): Consumer {
  const raw = c.req.header('X-Consumer') ?? c.req.query('consumer')
  return raw !== undefined && isConsumer(raw) ? raw : 'http'
}
