import type { GateDecision } from '../contract'

/**
 * The score-gate verdict (ADR-005), rendered the moment `meta` arrives — citations-first
 * UX. `answer` shows tier + model; `refuse` shows only the band + grounding (tier is moot).
 *
 * `projected` (Manual search): the deterministic /search path computes this SAME gate decision but
 * NEVER calls the LLM. So the model is what the gate WOULD route to, not one that answered — it renders
 * as "would route to <model>" to avoid implying a (billed) call on a "no LLM, no cost" search.
 */
export function DecisionBadge({
  decision,
  projected = false,
}: {
  decision: GateDecision
  projected?: boolean
}) {
  const { band, tier, model, groundingScore } = decision
  const isAnswer = band === 'answer'
  return (
    <div className={`badge badge--${band}`} role="status" aria-label={`decision: ${band}`}>
      <span className="badge__band">{isAnswer ? 'answer' : 'refused'}</span>
      {isAnswer && <span className={`badge__tier badge__tier--${tier}`}>{tier}</span>}
      <span className="badge__grounding" title="top-k fused retrieval score">
        grounding {groundingScore.toFixed(3)}
      </span>
      {isAnswer && (
        <span
          className="badge__model"
          title={
            projected
              ? 'the tier the gate WOULD route to — this deterministic search called no LLM (no cost)'
              : 'the model that produced this answer'
          }
        >
          {projected ? `would route to ${model}` : model}
        </span>
      )}
    </div>
  )
}
