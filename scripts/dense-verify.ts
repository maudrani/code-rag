import { resolve } from 'node:path'
import { createEngine } from '../src/membrane/index.js'

/**
 * dense-verify — proves the LIVE engine (outside vitest -> dense ON) actually wires the
 * dense leg: the ledger's scoresByLeg.dense must be > 0 for a real top hit.
 *
 * Uses a SMALL corpus (src/contracts, ~a dozen files) so the local ONNX embed finishes in
 * seconds — the dense wiring is corpus-independent, so this is a sufficient live proof and
 * far faster than embedding the whole repo. First run downloads the MiniLM model (~25MB).
 *   npx tsx scripts/dense-verify.ts
 */
async function main(): Promise<void> {
  // dense defaults ON here (not under vitest); small corpus keeps the embed quick.
  const engine = createEngine({ corpusPath: resolve('src/contracts') })
  const started = Date.now()
  await engine.query('what fields does the EngineConfig contract carry', [], 'package')
  const [entry] = engine.queryLog()
  const legs = entry?.scoresByLeg
  const dense = legs?.dense ?? 0
  console.log(`scoresByLeg: ${JSON.stringify(legs)}`)
  console.log(`ingest+query took ${Date.now() - started}ms (incl. model load + embedding)`)
  console.log(
    dense > 0
      ? 'DENSE WIRED LIVE (dense > 0) ✓'
      : 'dense = 0 — NOT wired (or the leg contributed nothing to the top result)',
  )
  process.exit(dense > 0 ? 0 : 1)
}

main().catch((e: unknown) => {
  console.error(`dense-verify failed: ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
})
