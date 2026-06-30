import { beforeAll, describe, expect, it } from 'vitest'
import { chunkSource } from '../../src/chunk/chunker.js'
import { initParser } from '../../src/chunk/parser.js'
import { collectChunkTelemetry } from '../../src/chunk/telemetry.js'

// TKT-108 (FTR-12) — ChunkTelemetry invariant gate (demonstrate-deterministically).
// Computed over REAL chunks; the invariants are non-vacuous (they fail if a kind/lang
// is dropped from the histogram, or if glueFallbacks drifts from the module count).

const sum = (r: Record<string, number>): number => Object.values(r).reduce((a, b) => a + b, 0)

describe('collectChunkTelemetry (TKT-108)', () => {
  beforeAll(async () => {
    await initParser()
  })

  it('count === Σ byKind === Σ byLang (every chunk has exactly one kind + one lang)', () => {
    // function + class(+method) + interface(other) + an overload (glue) + a loose import
    const src =
      "import { x } from './x'\n" +
      'export function f(a: number): number {\n  return a\n}\n' +
      'export interface I {\n  k: string\n}\n' +
      'export class C {\n  m(): number {\n    return 1\n  }\n}\n' +
      'export function g(a: string): string\n' +
      'export function g(a: number): number\n' +
      'export function g(a: unknown): unknown {\n  return a\n}\n'
    const tel = collectChunkTelemetry(chunkSource(src, 'mix.ts'))
    expect(tel.count).toBeGreaterThan(0)
    expect(tel.count).toBe(sum(tel.byKind))
    expect(tel.count).toBe(sum(tel.byLang))
    // the kinds actually present are counted (function, class, method, other, module)
    expect(tel.byKind.function).toBeGreaterThanOrEqual(2) // f + g impl
    expect(tel.byKind.other).toBeGreaterThanOrEqual(1) // interface I
    expect(tel.byKind.method).toBeGreaterThanOrEqual(1) // C.m
    expect(tel.byLang.typescript).toBe(tel.count)
  })

  it('glueFallbacks === the count of <module> glue chunks (semantic tied to the metric)', () => {
    const tel = collectChunkTelemetry(
      chunkSource("import { a } from './a'\nimport { b } from './b'\n", 'imports.ts'),
    )
    expect(tel.byKind.module).toBe(1)
    expect(tel.glueFallbacks).toBe(1)
    expect(tel.glueFallbacks).toBe(tel.byKind.module ?? 0)
  })

  it('an overload-signature demotion lands in the glue (module) count', () => {
    // the two body-less signatures are demoted to a <module> glue chunk
    const src =
      'export function f(a: string): string\nexport function f(a: number): number\nexport function f(a: unknown): unknown {\n  return a\n}\n'
    const tel = collectChunkTelemetry(chunkSource(src, 'ovl.ts'))
    expect(tel.glueFallbacks).toBeGreaterThanOrEqual(1) // the signatures' <module> chunk
    expect(tel.byKind.function).toBe(1) // the implementation only
  })

  it('empty chunks[] → all-zero, consistent struct', () => {
    const tel = collectChunkTelemetry([])
    expect(tel).toEqual({ count: 0, byKind: {}, byLang: {}, glueFallbacks: 0 })
    expect(tel.count).toBe(sum(tel.byKind))
  })
})
