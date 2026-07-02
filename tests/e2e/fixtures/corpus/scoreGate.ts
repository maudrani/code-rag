/**
 * scoreGate — the deterministic two-signal gate (ADR-005), mirrored here as a small,
 * REAL fixture so the E2E smoke retrieves an actual named symbol from actual code.
 * grounding decides the band (below the floor we refuse instead of hallucinating);
 * a complexity proxy decides the tier (cheap single-file lookup vs strong multi-file reasoning).
 */
export function scoreGate(
  grounding: number,
  complexity: number,
): { band: 'answer' | 'refuse'; tier: 'cheap' | 'strong' } {
  const GROUNDING_FLOOR = 0.2
  if (grounding < GROUNDING_FLOOR) {
    return { band: 'refuse', tier: 'cheap' }
  }
  return { band: 'answer', tier: complexity > 0.5 ? 'strong' : 'cheap' }
}
