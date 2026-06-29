import type {
  Citation,
  GateDecision,
  Projection,
  RankedChunk,
  ScoreGate,
} from '../contracts/index.js'

// Rough token heuristic — no tokenizer ships in-repo; chars/4 is the standard estimate.
// `tokensEst` is observability only (the real cost comes from the SDK usage at L5).
const CHARS_PER_TOKEN = 4

// Map a retrieved chunk to a clickable citation. Label = "symbol (path:start-end)".
export function buildCitation(ranked: RankedChunk): Citation {
  const { chunk } = ranked
  return {
    chunkId: chunk.id,
    path: chunk.path,
    span: chunk.span,
    label: `${chunk.symbol} (${chunk.path}:${chunk.span.startLine}-${chunk.span.endLine})`,
  }
}

// Assemble retrieved code into the prompt-context block + estimate its token cost.
// This string is what `buildPrompt` (the provider) reads verbatim as L5 context.
export function assembleContext(results: RankedChunk[]): { assembled: string; tokensEst: number } {
  const assembled = results
    .map(({ chunk }) => {
      const loc = `${chunk.path}:${chunk.span.startLine}-${chunk.span.endLine}`
      return `// ${loc} — ${chunk.symbol}\n${chunk.code}`
    })
    .join('\n\n')
  return { assembled, tokensEst: Math.ceil(assembled.length / CHARS_PER_TOKEN) }
}

export interface ProjectInput {
  queryId: string
  question: string
  resolvedQuery: string
  results: RankedChunk[]
  scoreGate: ScoreGate
}

// Build the SSOT Projection: the gate decision + citations + assembled context.
// Pure — the engine supplies the queryId, the resolved query, the retrieval results,
// and the (pure) score-gate; this composes them into the one shape every consumer reads.
export function project(input: ProjectInput): Projection {
  const { queryId, question, resolvedQuery, results, scoreGate } = input
  const decision: GateDecision = scoreGate(results, { question, resolvedQuery })
  return {
    queryId,
    question,
    resolvedQuery,
    results,
    citations: results.map(buildCitation),
    context: assembleContext(results),
    decision,
  }
}
