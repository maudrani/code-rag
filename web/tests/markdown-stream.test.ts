import { describe, expect, it } from 'vitest'
import { closeUnterminated } from '../src/lib/markdownStream'

// closeUnterminated balances an in-flight (streaming) markdown string so a partial answer
// renders contained — the runaway-code-block + dangling-inline cases — without mutating the
// stored content. It is render-only and self-corrects when the real closer streams in.
describe('closeUnterminated()', () => {
  it('closes an odd (unterminated) ``` code fence', () => {
    const out = closeUnterminated('here:\n```ts\nconst x = 1')
    // one fence in, two out -> balanced; react-markdown now renders a CONTAINED block.
    expect((out.match(/```/g) ?? []).length).toBe(2)
  })

  it('leaves a balanced (even) fence untouched', () => {
    const md = 'here:\n```ts\nconst x = 1\n```'
    expect(closeUnterminated(md)).toBe(md)
  })

  it('closes a dangling inline backtick', () => {
    const out = closeUnterminated('use the `query function')
    expect((out.match(/`/g) ?? []).length % 2).toBe(0)
  })

  it('leaves balanced inline code untouched', () => {
    const md = 'use the `query` function'
    expect(closeUnterminated(md)).toBe(md)
  })

  it('does not alter plain prose (no code markers)', () => {
    const md = 'just a sentence about the membrane, no code.'
    expect(closeUnterminated(md)).toBe(md)
  })

  it('does not count a fence as inline backticks (no double-close)', () => {
    // an open fence: closing adds exactly one ```, never a stray inline `.
    const out = closeUnterminated('```ts\nconst x = 1')
    expect(out.endsWith('```')).toBe(true)
    expect((out.match(/`/g) ?? []).length % 3).toBe(0)
  })
})
