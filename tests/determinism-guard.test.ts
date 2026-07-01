import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * FTR-4 TKT-005 — the determinism guard. The deterministic-gradient thesis (everything exact + tested
 * except L5) is only real if non-determinism cannot silently enter the imperative layers. This meta-test
 * fails if any raw non-deterministic source (Date.now(), Math.random(), new Date(...)) appears in src/.
 *
 * The membrane's ONE time source is the injected clock seam (`config.now ?? Date.now`, TKT-004) — that is
 * a function REFERENCE, not a Date.now() CALL, so the `Date.now()` pattern below does not match it. Any
 * new time/random read must go through an injected seam, not a raw global.
 */
const SRC = fileURLToPath(new URL('../src', import.meta.url))
const FORBIDDEN: Array<{ re: RegExp; name: string }> = [
  { re: /\bDate\.now\(\)/, name: 'Date.now()' },
  { re: /\bMath\.random\(\)/, name: 'Math.random()' },
  { re: /\bnew Date\(/, name: 'new Date(' },
]

function tsFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const p = `${dir}/${entry}`
    if (statSync(p).isDirectory()) out.push(...tsFiles(p))
    else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) out.push(p)
  }
  return out
}

/** drop a trailing line comment so a mention in a comment (e.g. the clock-seam doc) is not a violation. */
function codeOnly(line: string): string {
  const i = line.indexOf('//')
  return i === -1 ? line : line.slice(0, i)
}

describe('determinism guard: no raw non-deterministic sources in src (FTR-4 TKT-005)', () => {
  it('src/ has NO Date.now()/Math.random()/new Date( outside the injected-clock seam', () => {
    const violations: string[] = []
    for (const file of tsFiles(SRC)) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          const code = codeOnly(line)
          for (const { re, name } of FORBIDDEN) {
            if (re.test(code))
              violations.push(`${file.replace(SRC, 'src')}:${i + 1} [${name}] ${line.trim()}`)
          }
        })
    }
    expect(violations).toEqual([])
  })

  it('SELF-TEST: the scanner actually catches a violation (not a vacuous always-pass)', () => {
    // proves the patterns match real non-determinism, so a green run above is meaningful.
    expect(FORBIDDEN.some(({ re }) => re.test('const t = Date.now()'))).toBe(true)
    expect(FORBIDDEN.some(({ re }) => re.test('const r = Math.random()'))).toBe(true)
    expect(FORBIDDEN.some(({ re }) => re.test('const d = new Date(x)'))).toBe(true)
    // ...and does NOT flag the legitimate clock-seam reference (Date.now without a call).
    expect(FORBIDDEN.some(({ re }) => re.test('const now = config.now ?? Date.now'))).toBe(false)
  })
})
