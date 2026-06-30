/**
 * cost-dogfood — real per-tier cost numbers for the README (needs ANTHROPIC_API_KEY).
 *
 * Builds the engine, subscribes to the L5 `answer.usage` event (the only place the
 * membrane computes cost), runs a few representative queries through the full
 * pipeline (retrieve -> gate -> answer), and prints band / tier / tokens / estCost.
 *
 *   ANTHROPIC_API_KEY=... npx tsx scripts/cost-dogfood.ts
 */
import { ask, buildEngine } from '../src/consume/index.js'

const QUERIES = [
  'where is the score gate decided',
  'how does retrieval fuse the bm25, dense and structural legs',
  'how does the membrane compose the deterministic layers before the llm answer',
]

interface L5 {
  tokens: number
  tier: string
  estCost: number
}

async function main(): Promise<void> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) {
    process.stderr.write('cost-dogfood: set ANTHROPIC_API_KEY\n')
    process.exit(1)
  }

  const engine = buildEngine({ apiKey: key })
  const costByQuery = new Map<string, L5>()
  engine.on((e) => {
    if (e.layer === 'L5' && e.type === 'answer.usage') {
      costByQuery.set(e.queryId, e.payload as unknown as L5)
    }
  })

  const rows: Array<Record<string, unknown>> = []
  for (const q of QUERIES) {
    const started = Date.now()
    const result = await ask(engine, q, {})
    const cost = costByQuery.get(result.projection.queryId)
    rows.push({
      query: q.length > 46 ? `${q.slice(0, 43)}...` : q,
      band: result.projection.decision.band,
      tier: result.projection.decision.tier,
      model: result.projection.decision.model,
      tokens: cost?.tokens ?? 0,
      estCostUSD: cost ? Number(cost.estCost.toFixed(6)) : 0,
      ms: Date.now() - started,
    })
  }

  console.table(rows)
  const total = rows.reduce((s, r) => s + (r.estCostUSD as number), 0)
  process.stdout.write(`\ntotal estCost: $${total.toFixed(6)} over ${rows.length} answered queries\n`)
}

main().catch((e: unknown) => {
  process.stderr.write(`cost-dogfood failed: ${e instanceof Error ? e.message : String(e)}\n`)
  process.exit(1)
})
