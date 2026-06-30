import { parseArgs } from 'node:util'
import { CliError, EXIT } from './errors.js'

/** The parsed CLI invocation. v1 surface: `ask <query> [--dry] [--json]` (+ help/version). */
export type ParsedCommand =
  | { command: 'ask'; query: string; dry: boolean; json: boolean }
  | { command: 'help' }
  | { command: 'version' }

/**
 * parseCli — node:util parseArgs (D2: zero-dep, fits a one-command surface).
 * Two-phase: global flags (--help/--version) win; otherwise the `ask` subcommand
 * with its positional <query>. Any misuse (unknown flag/command, missing query)
 * becomes a CliError(EXIT.USAGE) — never a raw throw.
 */
export function parseCli(argv: string[]): ParsedCommand {
  const parsed = (() => {
    try {
      return parseArgs({
        args: argv,
        options: {
          dry: { type: 'boolean', default: false },
          json: { type: 'boolean', default: false },
          help: { type: 'boolean', short: 'h', default: false },
          version: { type: 'boolean', short: 'V', default: false },
        },
        allowPositionals: true,
        strict: true,
      })
    } catch (err) {
      // strict parseArgs throws on unknown options — surface as a usage error.
      const message = err instanceof Error ? err.message : 'invalid arguments'
      throw new CliError(message, EXIT.USAGE)
    }
  })()

  const { values, positionals } = parsed
  if (values.help === true) return { command: 'help' }
  if (values.version === true) return { command: 'version' }

  const [command, query] = positionals
  if (command !== 'ask') {
    throw new CliError(`unknown command: ${command ?? '(none)'} (expected: ask)`, EXIT.USAGE)
  }
  if (query === undefined) {
    throw new CliError('missing <query> — usage: code-rag ask <query> [--dry] [--json]', EXIT.USAGE)
  }

  return { command: 'ask', query, dry: values.dry === true, json: values.json === true }
}
