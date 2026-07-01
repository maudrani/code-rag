/**
 * markdownStream — streaming-safety for the answer (TKT-510).
 *
 * The answer arrives token-by-token, so at any frame the markdown can be MID-construct. The
 * ugly case is an unterminated ``` fence: react-markdown renders everything after it as one
 * runaway code block until the closing fence finally streams in. closeUnterminated() balances
 * the two runaway constructs — an open fence and a dangling inline backtick — for RENDER ONLY.
 * The stored message content is never mutated; when the real closer arrives this becomes a
 * no-op, so the block self-corrects.
 *
 * Scope: fences + inline code (the constructs that "run away" over the rest of the doc). An
 * unterminated **bold** / _italic_ renders as literal text and self-corrects — not a runaway —
 * so it is deliberately left alone (Vercel's streamdown solves the same set; we do it in ~12
 * lines without the Tailwind coupling, FTR-52 decision).
 */
export function closeUnterminated(md: string): string {
  let out = md

  // 1) Fenced code: an ODD number of ``` means the last block is still open -> close it.
  const fenceCount = (out.match(/```/g) ?? []).length
  if (fenceCount % 2 === 1) {
    out += `${out.endsWith('\n') ? '' : '\n'}\`\`\``
  }

  // 2) Inline code: count single backticks that are NOT part of a ``` fence; close a dangling one.
  const inlineTicks = (out.replace(/```/g, '').match(/`/g) ?? []).length
  if (inlineTicks % 2 === 1) {
    out += '`'
  }

  return out
}
