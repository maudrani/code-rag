/**
 * Host-exit safety probe (FTR-22 / onnxruntime pin ≥1.24.3). Run as a CHILD process by
 * tests/index/embedder-exit-safety.test.ts. It exercises the real embedder lifecycle the engine uses
 * — createOnnxEmbedder → embed → dispose → process teardown — and lets the process exit NATURALLY, so
 * the native onnxruntime teardown runs. On onnxruntime-node <1.24.3 that teardown aborted the host
 * (libc++abi: mutex lock failed → SIGABRT / exit 134, upstream #24579). A clean exit 0 proves the
 * version floor actually holds — the behavioral complement to the package.json config shield.
 */
import { createOnnxEmbedder } from '../../../src/index/embed.js'

const embedder = createOnnxEmbedder()
const [vector] = await embedder.embed(['onnxruntime host-exit safety probe'])
if (vector === undefined || vector.length === 0) {
  console.error('EMBED_EMPTY') // sanity: the model actually ran, not a silent no-op exit 0
  process.exit(2)
}
await embedder.dispose?.() // release the native threadpool (the engine's real teardown path)
console.log('EMBED_OK', vector.length)
// NO explicit process.exit — let node's natural teardown run the native destructors (the abort site).
