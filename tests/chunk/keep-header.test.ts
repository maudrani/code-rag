import { beforeAll, describe, expect, it } from 'vitest'
import { chunkSource } from '../../src/chunk/chunker.js'
import { initParser } from '../../src/chunk/parser.js'
import type { Chunk } from '../../src/contracts/chunk.js'

// TKT-106 (FTR-12) — the KEEP-HEADER gate. The retrieval definition-boost pins the
// queried symbol's defining chunk into RRF at rank 0; that guarantee is only as good
// as the chunk — the chunk MUST contain the symbol's full definition: signature +
// body in ONE chunk, AND any leading decorators (a route `@Get('/users')` IS the
// endpoint). Adopts the keep-header / "walk back over decorator siblings" pattern
// (peripheral cast.ts:160; skill code-chunking; verified by AST spike).
//
// NON-VACUITY (demonstrate-deterministically P4): the decorator assertions FAIL if
// the emitClass decorator-accumulation is removed — delete the fix -> red.

const bySymbol = (chunks: Chunk[], symbol: string): Chunk => {
  const found = chunks.find((c) => c.symbol === symbol)
  if (found === undefined) throw new Error(`expected a chunk for symbol "${symbol}"`)
  return found
}

describe('keep-header — signature rides with the body (TKT-106)', () => {
  beforeAll(async () => {
    await initParser()
  })

  it('a multi-line generic signature is kept whole with its body (never split mid-signature)', () => {
    const src =
      'export function transform<\n  TIn extends Record<string, unknown>,\n  TOut,\n>(\n  input: TIn,\n  map: (v: TIn) => TOut,\n): TOut {\n  return map(input)\n}\n'
    const c = bySymbol(chunkSource(src, 'transform.ts'), 'transform')
    expect(c.code).toContain('export function transform<') // signature head
    expect(c.code).toContain('): TOut {') // signature tail
    expect(c.code).toContain('return map(input)') // body
    expect(c.span.endLine).toBeGreaterThan(c.span.startLine)
  })

  it('keep-header holds across kinds: each symbol carries its own signature + a body line in ONE chunk', () => {
    const src =
      'export function fn(a: number): number {\n  return a + 1\n}\n\nexport class K {\n  m(): number {\n    return 2\n  }\n}\n'
    const chunks = chunkSource(src, 'kinds.ts')
    const fn = bySymbol(chunks, 'fn')
    expect(fn.code).toContain('export function fn(a: number): number')
    expect(fn.code).toContain('return a + 1')
    const method = bySymbol(chunks, 'K.m')
    expect(method.code).toContain('m(): number')
    expect(method.code).toContain('return 2')
  })

  it('NEGATIVE: one symbol’s signature does not bleed into a different symbol’s chunk', () => {
    const src =
      'export function alpha(): number {\n  return 1\n}\n\nexport function beta(): number {\n  return 2\n}\n'
    const chunks = chunkSource(src, 'two.ts')
    expect(bySymbol(chunks, 'beta').code).not.toContain('function alpha')
    expect(bySymbol(chunks, 'alpha').code).not.toContain('function beta')
  })
})

describe('keep-header — decorators ride with the member they annotate (TKT-106, SC-1)', () => {
  beforeAll(async () => {
    await initParser()
  })

  it('a decorated method keeps its leading decorator in the chunk code (span starts at the decorator)', () => {
    const src =
      'export class Widget {\n  name = ""\n\n  @HostListener("click")\n  onClick(): void {\n    this.name = "x"\n  }\n}\n'
    const chunks = chunkSource(src, 'widget.ts')
    const onClick = bySymbol(chunks, 'Widget.onClick')
    // the decorator is part of the method's definition — it must be in the chunk
    expect(onClick.code).toContain('@HostListener("click")')
    expect(onClick.code).toContain('onClick(): void')
    expect(onClick.code).toContain('this.name = "x"')
    // span starts at the decorator line (line 4), not the method line (line 5)
    expect(onClick.span.startLine).toBe(4)
  })

  it('ALL stacked decorators are captured (span starts at the FIRST)', () => {
    const src =
      'export class C {\n  @A()\n  @B("x")\n  @D\n  run(): number {\n    return 1\n  }\n}\n'
    const run = bySymbol(chunkSource(src, 'stack.ts'), 'C.run')
    expect(run.code).toContain('@A()')
    expect(run.code).toContain('@B("x")')
    expect(run.code).toContain('@D')
    expect(run.code).toContain('run(): number')
    expect(run.span.startLine).toBe(2) // first decorator
  })

  it('SC-3: a symbol referenced inside a method decorator resolves into the method’s structuralRefs', () => {
    const src =
      "import { AuthGuard } from './auth.guard'\nexport class UsersController {\n  @UseGuards(AuthGuard)\n  @Get('/users')\n  list(): string {\n    return 'ok'\n  }\n}\n"
    const list = bySymbol(chunkSource(src, 'users.controller.ts'), 'UsersController.list')
    // the decorator factory is a call the method depends on
    expect(list.structuralRefs.calls).toContain('Get')
    // AuthGuard is imported + used in the decorator -> its import edge belongs to the method
    expect(list.structuralRefs.imports).toContain('./auth.guard')
    // and the route literal is now in context (the endpoint IS the decorator)
    expect(list.code).toContain("@Get('/users')")
  })
})

describe('keep-header — decorator edge cases (TKT-106)', () => {
  beforeAll(async () => {
    await initParser()
  })

  it('consecutive decorated methods: each span starts at its OWN decorator', () => {
    const src =
      'export class S {\n  @A()\n  one(): number {\n    return 1\n  }\n  @B()\n  two(): number {\n    return 2\n  }\n}\n'
    const chunks = chunkSource(src, 'consec.ts')
    const one = bySymbol(chunks, 'S.one')
    const two = bySymbol(chunks, 'S.two')
    expect(one.code).toContain('@A()')
    expect(one.code).not.toContain('@B()') // does not swallow the next method’s decorator
    expect(two.code).toContain('@B()')
    expect(two.code).not.toContain('@A()')
    expect(two.code).not.toContain('one(): number') // no bleed from the previous method
  })

  it('an UNDECORATED method after a decorated one is not over-extended (no stray decorator)', () => {
    const src =
      'export class S {\n  @A()\n  decorated(): number {\n    return 1\n  }\n  plain(): number {\n    return 2\n  }\n}\n'
    const plain = bySymbol(chunkSource(src, 'mixed.ts'), 'S.plain')
    expect(plain.code).not.toContain('@A()')
    expect(plain.code).toContain('plain(): number')
    expect(plain.span.startLine).toBe(6) // the method line, not pulled back
  })

  it('a decorator on a non-method member (property) is not mis-attached to the next method', () => {
    const src =
      'export class S {\n  @Input()\n  name = ""\n  greet(): string {\n    return this.name\n  }\n}\n'
    const greet = bySymbol(chunkSource(src, 'prop.ts'), 'S.greet')
    // @Input() belongs to the `name` property (rides in the class chunk), NOT to greet()
    expect(greet.code).not.toContain('@Input()')
    expect(greet.span.startLine).toBe(4)
  })
})
