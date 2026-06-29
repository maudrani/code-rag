/**
 * Base-URL config — the single M1-assembly swap point. Default '' = same-origin, which in
 * dev is the mock dev-server (TKT-502). At M1 assembly, set VITE_API_BASE to the `surface`
 * host and nothing else changes. No secrets live here: the browser never holds an API key
 * (those stay server-side in `surface`).
 */
export const API_BASE: string = (import.meta.env.VITE_API_BASE as string | undefined) ?? ''

/**
 * WebSocket base for the trace stream. Empty = same-origin (the browser resolves the
 * relative `/ws/trace` to ws:// against the page). For an absolute http(s) API_BASE
 * (M1 assembly vs `surface`), swap the scheme to ws(s):// so the WebSocket URL is valid.
 */
export const WS_BASE: string = API_BASE ? API_BASE.replace(/^http/, 'ws') : ''
