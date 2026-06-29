/**
 * Shared TS corpus for chunker + structuralRefs + fixture-generation tests.
 *
 * Kept as an exported STRING (not a compiled .ts module) so the deliberately
 * diverse / "unused" constructs do not trip the repo's strict tsc flags
 * (noUnusedLocals etc.) — the root tsconfig is master-owned, outside this
 * timeline (RULE-011). The chunker treats this as source text from `sample.ts`.
 */
export const SAMPLE_PATH = 'sample.ts'

export const SAMPLE = `import { helper } from './helper'

export function greet(name: string): string {
  return helper(name)
}

function internal(): number {
  return 42
}

export const double = (n: number): number => n * 2

const config = { enabled: true }

export interface Widget {
  id: string
}

type WidgetOrNull = Widget | null

enum Color {
  Red,
  Blue,
}

export class Service {
  constructor(private readonly w: Widget) {}
  process(): string {
    return internal().toString()
  }
  get id(): string {
    return this.w.id
  }
}
`
