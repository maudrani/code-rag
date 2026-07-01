import { parseArgs } from 'node:util'
import { isConsumer, isStatsLayer, type StatsLayer } from '../consume/index.js'
import type { Consumer } from '../contracts/telemetry.js'
import { CliError, EXIT } from './errors.js'

/**
 * The parsed CLI invocation. Surface: the conversational `ask` plus the telemetry
 * read-surfaces `stats` / `health` / `log` (+ help/version). Optional fields are
 * OMITTED when absent (exactOptionalPropertyTypes), never set to undefined.
 */
export type ParsedCommand =
  | { command: 'ask'; query: string; dry: boolean; json: boolean }
  | { command: 'stats'; layer?: StatsLayer; json: boolean }
  | { command: 'health'; json: boolean }
  | { command: 'log'; consumer?: Consumer; tail?: number; json: boolean }
  | { command: 'symbols'; json: boolean }
  | { command: 'help' }
  | { command: 'version' }

/**
 * parseCli — node:util parseArgs (D2: zero-dep). Global flags (--help/--version)
 * win; otherwise a subcommand with its options. Any misuse (unknown flag/command,
 * missing/invalid arg) becomes a CliError(EXIT.USAGE) — never a raw throw.
 */
export function parseCli(argv: string[]): ParsedCommand {
  const parsed = (() => {
    try {
      return parseArgs({
        args: argv,
        options: {
          dry: { type: 'boolean', default: false },
          json: { type: 'boolean', default: false },
          layer: { type: 'string' },
          consumer: { type: 'string' },
          tail: { type: 'string' },
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

  const [command, arg] = positionals
  const json = values.json === true

  switch (command) {
    case 'ask': {
      if (arg === undefined) {
        throw new CliError(
          'missing <query> — usage: code-rag ask <query> [--dry] [--json]',
          EXIT.USAGE,
        )
      }
      return { command: 'ask', query: arg, dry: values.dry === true, json }
    }
    case 'stats':
      return values.layer === undefined
        ? { command: 'stats', json }
        : { command: 'stats', layer: parseLayer(values.layer), json }
    case 'health':
      return { command: 'health', json }
    case 'log': {
      const result: { command: 'log'; consumer?: Consumer; tail?: number; json: boolean } = {
        command: 'log',
        json,
      }
      if (values.consumer !== undefined) result.consumer = parseConsumer(values.consumer)
      if (values.tail !== undefined) result.tail = parseTail(values.tail)
      return result
    }
    case 'symbols':
      return { command: 'symbols', json }
    default:
      throw new CliError(
        `unknown command: ${command ?? '(none)'} (expected: ask | stats | health | log | symbols)`,
        EXIT.USAGE,
      )
  }
}

/** Validate `--layer` against the telemetry contract's selectable layers. */
function parseLayer(value: string): StatsLayer {
  if (!isStatsLayer(value)) {
    throw new CliError(
      `invalid --layer '${value}' (expected: ingest | chunk | index | retrieve | answer)`,
      EXIT.USAGE,
    )
  }
  return value
}

/** Validate `--consumer` against the ledger's Consumer union. */
function parseConsumer(value: string): Consumer {
  if (!isConsumer(value)) {
    throw new CliError(
      `invalid --consumer '${value}' (expected: web | http | cli | mcp | package)`,
      EXIT.USAGE,
    )
  }
  return value
}

/** Parse `--tail N` as a positive integer. */
function parseTail(value: string): number {
  const n = Number(value)
  if (!Number.isInteger(n) || n <= 0) {
    throw new CliError(`invalid --tail '${value}' (expected a positive integer)`, EXIT.USAGE)
  }
  return n
}
