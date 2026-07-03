import { buildPrompt } from '../src/answer/prompt.js'
import { buildEngine, resolveCorpusSource } from '../src/consume/index.js'

/**
 * show-prompt — print the EXACT substrate + final prompt L5 sends to the LLM for a query, WITHOUT
 * calling the model. Deterministic: engine.query() is the membrane (retrieve + project), no LLM, no
 * cost. It follows the active corpus (CODE_RAG_STATE), so it reflects whatever the web ingested.
 * Run dense-off to stay heat-safe alongside a running server:
 *   CODE_RAG_STATE=/tmp/code-rag/state.json CODE_RAG_DENSE=false \
 *     pnpm exec tsx scripts/show-prompt.ts "how does ky handle retries"
 *
 * The `system` block is the "mise en place": the answer-only policy + the assembled context (the
 * retrieved code) + the citable ids. That is the substrate — the LLM only reasons over THIS.
 */
async function main(): Promise<void> {
  const query = process.argv.slice(2).join(' ').trim() || 'how does retrieval fuse the legs'
  const corpusPath = await resolveCorpusSource({ env: process.env })
  const engine = buildEngine(corpusPath !== undefined ? { corpusPath } : {})
  const projection = await engine.query(query, [], 'cli')
  const d = projection.decision

  process.stdout.write(`QUERY: ${query}\n`)
  process.stdout.write(
    `gate: band=${d.band} tier=${d.tier} model=${d.model} grounding=${d.groundingScore.toFixed(3)}\n`,
  )
  if (d.band !== 'answer') {
    process.stdout.write(
      '\n(the gate REFUSED — nothing is sent to the LLM; below is the substrate that WOULD have gone)\n',
    )
  }

  const prompt = buildPrompt(projection, [])
  process.stdout.write(
    '\n===== SYSTEM — the substrate: answer-only policy + assembled context + citable ids =====\n\n',
  )
  process.stdout.write(prompt.system)
  process.stdout.write('\n\n===== MESSAGES — exactly what the LLM API receives =====\n\n')
  process.stdout.write(JSON.stringify(prompt.messages, null, 2))
  process.stdout.write('\n')
}

main().catch((e: unknown) => {
  process.stderr.write(`show-prompt failed: ${e instanceof Error ? e.message : String(e)}\n`)
  process.exit(1)
})
