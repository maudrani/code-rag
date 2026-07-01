/**
 * Semantic grounding floor (FTR-55) — the retrieval-owned constant + helper the answer gate consumes.
 *
 * The dense leg's raw cosine (surfaced by rrfFuse onto RankedChunk.cosine) is the ABSOLUTE match
 * quality the rank-based `fused` score cannot express. The score-gate grounds an answer when EITHER
 * lexical overlap OR this semantic signal is strong (design semantic-grounding-floor.md §4). The
 * floor + the helper live HERE — the layer that owns the cosine — so there is ONE documented,
 * corpus-tuned constant (TKT-337 + ProsusAI: expose/threshold the RAW number; never a baked 0..1
 * confidence). The answer layer owns the gate LOGIC; retrieval owns this datum it thresholds.
 */
import type { RetrievalResult } from '../contracts/retrieval.js'

/**
 * The semantic grounding floor — the single corpus-tuned SSOT lives in the contract (next to
 * RankedChunk.cosine, with the measured-separation rationale); re-exported here so retrieval's
 * RUN_SLOW cos-floor eval and the answer gate share ONE constant (FTR-55). Retrieval MEASURED it
 * (`tests/retrieve/cos-floor.eval.test.ts`, documented in `eval.md`); the contract records the value.
 */
export { COS_FLOOR } from '../contracts/retrieval.js'

/**
 * The strongest dense cosine among the top-`n` hits — the query's semantic-grounding score (0..1).
 * Ignores hits with no dense signal (`cosine === undefined` ⇒ absent, not zero); 0 when none of the
 * top-`n` carried a cosine (a purely lexical/structural result contributes NO semantic signal).
 */
export function topCosine(results: RetrievalResult, n = 3): number {
  let max = 0
  let seen = false
  for (const r of results.slice(0, n)) {
    if (r.cosine === undefined) continue
    seen = true
    if (r.cosine > max) max = r.cosine
  }
  return seen ? max : 0
}
