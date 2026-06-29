import type { Turn } from '../contracts/index.js'

// L0 — deterministic anaphora gate. Decides whether a follow-up question depends on
// prior turns (and therefore needs the LLM rewrite residue) or is already standalone.
// Intent: only spend a `provider.rewrite` call when the question genuinely references
// context. A miss only degrades retrieval slightly; a false-positive costs one cheap
// (haiku) call — so we bias toward catching anaphora but suppress on a concrete subject.
//
// M1 heuristic (documented limitation): a learned/LLM anaphora detector is the scale
// answer; this is exact, fast, and unit-asserted — fitting the determinism gradient.

// A back-reference signal: a leading conjunction/fragment, a bare third-person pronoun,
// or a demonstrative bound to a generic (un-named) code noun.
const ANAPHORA =
  /^(and|but|or|so|then|also|plus)\b|^(what|how)\s+about\b|\b(it|its|they|them|those|these)\b|\b(this|that)\s+(one|function|class|method|file|code|module|thing|part|error|test|change|approach|logic)\b/i

// A "concrete subject" is a code-identifier-shaped token (camelCase, snake_case,
// PascalCase type, a `backtick` span, a call(), or a file path). Its presence means the
// question carries its own subject and does not need history.
const CONCRETE =
  /[a-z][a-zA-Z0-9]*[A-Z]|[a-z0-9]+_[a-z0-9]+|`[^`]+`|\b\w+\(\)|\b[\w/.-]+\.(?:ts|mts|cts|tsx|js|jsx)\b|\b[A-Z][a-z]+[A-Z][a-zA-Z]*\b/

export function needsRewrite(question: string, history: Turn[]): boolean {
  if (history.length === 0) return false
  const q = question.trim()
  if (q.length === 0) return false
  if (CONCRETE.test(q)) return false
  return ANAPHORA.test(q)
}
