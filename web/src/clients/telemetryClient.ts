/**
 * Telemetry client for GET /stats + GET /health (ADR-008, observability design §5.2) — the
 * DETERMINISTIC read-surface: no LLM, no token cost. Types come from the type-only contract bridge
 * (../contract -> the master SSOT src/contracts/telemetry), so the wire stays zero-drift.
 */
import type { EngineTelemetry, HealthReport } from '../contract'

const JSON_HEADERS = { Accept: 'application/json' }

/** GET /stats — the full holding snapshot (ingest/chunk/index + the last query). Throws on !ok. */
export async function fetchStats(baseUrl = ''): Promise<EngineTelemetry> {
  const res = await fetch(`${baseUrl}/stats`, { headers: JSON_HEADERS })
  if (!res.ok) {
    throw new Error(`/stats failed: ${res.status}`)
  }
  return (await res.json()) as EngineTelemetry
}

/**
 * GET /health — the aggregate readiness surface. The server answers 200 for ok/degraded and 503
 * for `down`, but the 503 body is STILL a valid HealthReport: `down` is telemetry, not a transport
 * error. So we parse+return the body regardless of the status code — a client that threw on 503
 * would blank the health card at the exact moment it matters most. We only propagate a throw when
 * there is no report to read at all (a genuine network failure or a non-JSON body).
 */
export async function fetchHealth(baseUrl = ''): Promise<HealthReport> {
  const res = await fetch(`${baseUrl}/health`, { headers: JSON_HEADERS })
  return (await res.json()) as HealthReport
}
