/**
 * L2 chunk telemetry (TKT-108, FTR-12) — a pure projection of the emitted `Chunk[]`
 * onto the master-owned `ChunkTelemetry` contract (`src/contracts/telemetry.ts`). The
 * membrane holds the result in `Observable.telemetry().chunk`; surface reads it via
 * `code-rag stats --layer chunk`. Pure + deterministic — no I/O, no clock.
 *
 * `glueFallbacks`: the count of `<module>` glue chunks — contiguous top-level code NOT
 * captured as a named symbol (imports / re-exports, plus body-less / overload
 * signatures demoted from symbol-hood in `chunker.ts`). It is the honest,
 * chunk-derivable "code outside a symbol boundary" signal; a higher value flags lower
 * symbol coverage. (A strict demoted-symbol-only count would need chunker
 * instrumentation — noted as a follow-up; the ratified seam is `collectChunkTelemetry(chunks)`.)
 */
import type { Chunk } from '../contracts/chunk.js'
import type { ChunkTelemetry } from '../contracts/telemetry.js'

export function collectChunkTelemetry(chunks: readonly Chunk[]): ChunkTelemetry {
  const byKind: Record<string, number> = {}
  const byLang: Record<string, number> = {}
  for (const c of chunks) {
    byKind[c.kind] = (byKind[c.kind] ?? 0) + 1
    byLang[c.lang] = (byLang[c.lang] ?? 0) + 1
  }
  return {
    count: chunks.length,
    byKind,
    byLang,
    glueFallbacks: byKind.module ?? 0,
  }
}
