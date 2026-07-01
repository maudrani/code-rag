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

/**
 * True when the UI is talking to the in-dev MOCK wire (mockWirePlugin) and NOT a real backend:
 * we are in Vite dev mode AND no external API base was configured. In a production build
 * (`import.meta.env.DEV` is false) or when `VITE_API_BASE` points at `surface`, this is false.
 *
 * Drives the always-visible "MOCK DATA" banner (operator QA trust fix): during a demo it must be
 * IMPOSSIBLE to mistake the deterministic dev fixtures for a live backend — the mock and the real
 * thing look identical otherwise.
 */
export const IS_MOCK_BACKEND: boolean = Boolean(import.meta.env.DEV) && API_BASE === ''
