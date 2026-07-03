/**
 * src/consume — the actions layer (ADR-012 D1): the verbs the CLI and the MCP
 * both bind. One config loader (buildEngine), one orchestration (ask), one
 * serializer (serializeProjection) → the two transports cannot drift.
 */
export type { AskOptions, AskResult } from './actions.js'
export { ask, buildEngine, resolveEngineConfig } from './actions.js'
export type { ActiveCorpus } from './activeCorpus.js'
export { activeCorpusFile, readActiveCorpus, writeActiveCorpus } from './activeCorpus.js'
export type { CloneDeps, CorpusSourceOpts } from './corpus.js'
export {
  assertSafeRepoUrl,
  isRepoUrl,
  redactUrl,
  repoCacheDir,
  resolveCorpus,
  resolveCorpusSource,
} from './corpus.js'
export type { LedgerLine, LedgerOutcome, LedgerSink } from './ledger.js'
export {
  clearLedger,
  JsonlLedgerSink,
  readLedger,
  readLedgerLines,
  resolveLedgerPath,
  withLedger,
} from './ledger.js'
export { isDirectRun } from './mainModule.js'
export type { ProjectionDTO, SerializedResult } from './serialize.js'
export { serializeProjection } from './serialize.js'
export type {
  LayerStats,
  LayerTelemetry,
  LogPayload,
  StatsLayer,
  SymbolsPayload,
} from './telemetry.js'
export {
  CONSUMERS,
  getHealth,
  getLog,
  getLogPayload,
  getStats,
  getSymbols,
  getSymbolsPayload,
  isConsumer,
  isStatsLayer,
  STATS_LAYERS,
  selectLayer,
} from './telemetry.js'
