import type { GateDecision } from '../contract'

/**
 * The score-gate verdict (ADR-005), rendered the moment `meta` arrives — citations-first
 * UX. `answer` shows tier + model; `refuse` shows only the band + grounding (tier is moot).
 */
export function DecisionBadge({ decision }: { decision: GateDecision }) {
  const { band, tier, model, groundingScore } = decision
  const isAnswer = band === 'answer'
  return (
    <div className={`badge badge--${band}`} role="status" aria-label={`decision: ${band}`}>
      <span className="badge__band">{isAnswer ? 'answer' : 'refused'}</span>
      {isAnswer && <span className={`badge__tier badge__tier--${tier}`}>{tier}</span>}
      <span className="badge__grounding" title="top-k fused retrieval score">
        grounding {groundingScore.toFixed(3)}
      </span>
      {isAnswer && <span className="badge__model">{model}</span>}
    </div>
  )
}
