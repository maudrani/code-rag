// A tiny corpus fixture for the CLI real-engine `--dry` test. Parsed by the
// engine (tree-sitter), never executed as a test.

export function greet(name: string): string {
  return `hello ${name}`
}

export function farewell(name: string): string {
  return `goodbye ${name}`
}

export class Greeter {
  constructor(private readonly prefix: string) {}

  say(name: string): string {
    return `${this.prefix} ${name}`
  }
}
