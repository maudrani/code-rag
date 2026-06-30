import { describe, expect, it } from 'vitest'
import { CliError, EXIT } from '../../../src/cli/errors.js'
import { parseCli } from '../../../src/cli/parse.js'

function usageCode(argv: string[]): number | undefined {
  try {
    parseCli(argv)
  } catch (err) {
    return err instanceof CliError ? err.code : -1
  }
  return undefined // did not throw
}

describe('parseCli — TKT-410', () => {
  it('`ask foo` -> ask command, no flags', () => {
    expect(parseCli(['ask', 'foo'])).toEqual({
      command: 'ask',
      query: 'foo',
      dry: false,
      json: false,
    })
  })

  it('`ask foo --dry --json` -> both flags set', () => {
    expect(parseCli(['ask', 'foo', '--dry', '--json'])).toEqual({
      command: 'ask',
      query: 'foo',
      dry: true,
      json: true,
    })
  })

  it('flags before the positional parse the same (`ask --dry foo`)', () => {
    expect(parseCli(['ask', '--dry', 'foo'])).toEqual({
      command: 'ask',
      query: 'foo',
      dry: true,
      json: false,
    })
  })

  it('--help / -h -> help command', () => {
    expect(parseCli(['--help'])).toEqual({ command: 'help' })
    expect(parseCli(['-h'])).toEqual({ command: 'help' })
  })

  it('--version / -V -> version command', () => {
    expect(parseCli(['--version'])).toEqual({ command: 'version' })
    expect(parseCli(['-V'])).toEqual({ command: 'version' })
  })

  it('NEGATIVE: missing query -> CliError(USAGE)', () => {
    expect(usageCode(['ask'])).toBe(EXIT.USAGE)
  })

  it('NEGATIVE: unknown command -> CliError(USAGE)', () => {
    expect(usageCode(['bogus'])).toBe(EXIT.USAGE)
  })

  it('NEGATIVE: unknown flag -> CliError(USAGE)', () => {
    expect(usageCode(['ask', 'foo', '--nope'])).toBe(EXIT.USAGE)
  })

  it('NEGATIVE: no args at all -> CliError(USAGE)', () => {
    expect(usageCode([])).toBe(EXIT.USAGE)
  })
})
