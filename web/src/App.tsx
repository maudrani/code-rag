/**
 * App shell — placeholder for the scaffold (TKT-501).
 *
 * TKT-508 wires the real surfaces (chat tab, manual-search tab, trace rail). For now
 * we render a <main> landmark so the smoke test proves the toolchain renders React.
 */
export function App() {
  return (
    <main>
      <h1>code-rag</h1>
      <p>Ask the codebase — streaming answers grounded in clickable citations.</p>
      <p>UI under construction (FTR-51).</p>
    </main>
  )
}
