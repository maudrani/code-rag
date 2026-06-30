/**
 * CLI error model — adopts peripheral's `CliError { code }` (native-read
 * cli/src/errors.ts) with standard Unix exit codes (peripheral's were
 * domain-specific). The top-level entry maps a thrown CliError to its code.
 */
export const EXIT = {
  OK: 0,
  ERROR: 1,
  /** misuse: bad flags / missing args (Unix convention) */
  USAGE: 2,
  /** terminated by Ctrl-C (128 + SIGINT) */
  INTERRUPT: 130,
} as const

export type ExitCode = (typeof EXIT)[keyof typeof EXIT]

export class CliError extends Error {
  constructor(
    message: string,
    readonly code: number = EXIT.ERROR,
  ) {
    super(message)
    this.name = 'CliError'
  }
}
