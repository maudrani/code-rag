import type { ReactNode } from 'react'
import type { EngineTelemetry } from '../../contract'
import { AnswerCard, ChunkCard, IndexCard, IngestCard, RetrieveCard } from './LayerCards'

export type LayerKey = 'ingest' | 'chunk' | 'index' | 'retrieve' | 'answer'

export interface GlossaryEntry {
  term: string
  meaning: string
}

/**
 * Per-layer descriptive content for the Observability sub-tabs (FTR-56 P3). Each layer owns: a blurb
 * (what it measures), a glossary (what each number means — the operator asked for this), the card that
 * renders its live telemetry, and the exact CLI command an agent-owning-that-layer would run. The CLI
 * command sells the thesis: this telemetry is programmatically accessible per layer, byte-identical
 * across CLI · MCP · HTTP (src/cli/run.ts: "byte-identical across CLI, MCP, and HTTP").
 */
export interface LayerContent {
  key: LayerKey
  label: string
  title: string
  blurb: string
  glossary: GlossaryEntry[]
  /** the command a per-layer agent runs for this telemetry (CLI/MCP/HTTP parity). */
  cli: string
  card: (t: EngineTelemetry) => ReactNode
}

export const LAYERS: LayerContent[] = [
  {
    key: 'ingest',
    label: 'L1',
    title: 'Ingest',
    blurb:
      'The corpus walk — which files were discovered, which produced chunks, and how long the walk + parse took.',
    glossary: [
      {
        term: 'Files indexed / walked',
        meaning: 'Source files that produced ≥1 chunk, out of every file discovered on disk.',
      },
      {
        term: 'Skipped',
        meaning: 'Files ignored deliberately — binaries, oversized, vendored, or gitignored.',
      },
      { term: 'Errors', meaning: 'Files that failed to parse — surfaced, never silently dropped.' },
      {
        term: 'Chunks',
        meaning: 'Symbol-level units (functions / classes / …) the retriever later ranks.',
      },
      { term: 'Duration', meaning: 'Wall-clock for the whole ingest (walk + parse + chunk).' },
    ],
    cli: 'code-rag stats --layer ingest',
    card: (t) => <IngestCard data={t.ingest} />,
  },
  {
    key: 'chunk',
    label: 'L2',
    title: 'Chunk',
    blurb:
      'How the source was cut into retrievable units — the total, the kind distribution, and how often the chunker fell back to a whole-module glue chunk.',
    glossary: [
      {
        term: 'Total chunks',
        meaning: 'Symbol-level units after chunking — the retrieval corpus.',
      },
      {
        term: 'By kind',
        meaning: 'The AST node each chunk came from (function, interface, class, …).',
      },
      {
        term: 'Glue fallbacks',
        meaning:
          'Symbols too large/complex to isolate, demoted to a <module> chunk — a chunker-health signal (high = coarser granularity).',
      },
    ],
    cli: 'code-rag stats --layer chunk',
    card: (t) => <ChunkCard data={t.chunk} />,
  },
  {
    key: 'index',
    label: 'L3',
    title: 'Index',
    blurb:
      'The built retrieval index — how many documents it holds, its footprint, and how fresh the last build is.',
    glossary: [
      { term: 'Documents', meaning: 'Chunks indexed for search (BM25 + dense vectors).' },
      { term: 'Size', meaning: 'On-disk footprint; “in-memory” when the index is :memory:.' },
      {
        term: 'Built',
        meaning: 'Age of the last index build (staleMs = now − builtAt at snapshot time).',
      },
    ],
    cli: 'code-rag stats --layer index',
    card: (t) => <IndexCard data={t.index} />,
  },
  {
    key: 'retrieve',
    label: 'L4',
    title: 'Retrieve',
    blurb:
      'The last query’s retrieval — which consumer asked, the latency, and the fused score contribution of each hybrid leg (BM25, dense, structural).',
    glossary: [
      {
        term: 'Consumer',
        meaning: 'Which of web / http / cli / mcp / package issued it — one ledger sees all.',
      },
      { term: 'Results', meaning: 'Candidate chunks returned for the query.' },
      { term: 'Latency', meaning: 'Retrieve wall-clock for this query.' },
      {
        term: 'Fused score by leg',
        meaning:
          'Each leg’s top RRF contribution. dense being non-zero means the embedder is live (FTR-53).',
      },
      {
        term: 'Band',
        meaning: 'answer vs refuse — the score-gate’s decision from the fused score.',
      },
    ],
    cli: 'code-rag stats --layer retrieve',
    card: (t) => <RetrieveCard entry={t.lastQuery?.retrieve ?? null} />,
  },
  {
    key: 'answer',
    label: 'L5',
    title: 'Answer',
    blurb:
      'The only non-deterministic layer — the LLM. Which tier/model answered the last query, and its token + cost footprint.',
    glossary: [
      {
        term: 'Band',
        meaning: 'answer or refuse — refuse means the gate withheld the LLM entirely.',
      },
      {
        term: 'Tier',
        meaning: 'cheap vs strong — the score-gate’s cost/quality choice for this query.',
      },
      { term: 'Model', meaning: 'The provider model that produced the answer.' },
      { term: 'Tokens', meaning: 'Completion tokens generated.' },
      { term: 'Est. cost', meaning: 'USD estimate for the call (tokens × model rate).' },
    ],
    cli: 'code-rag stats --layer answer',
    card: (t) => <AnswerCard data={t.lastQuery?.answer ?? null} />,
  },
]
