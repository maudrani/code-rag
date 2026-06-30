/**
 * src/consume — the actions layer (ADR-012 D1): the verbs the CLI and the MCP
 * both bind. One config loader (buildEngine), one orchestration (ask), one
 * serializer (serializeProjection) → the two transports cannot drift.
 */
export type { AskOptions, AskResult } from './actions.js'
export { ask, buildEngine, resolveEngineConfig } from './actions.js'
export type { ProjectionDTO, SerializedResult } from './serialize.js'
export { serializeProjection } from './serialize.js'
