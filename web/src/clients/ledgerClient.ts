/**
 * Ledger client — DELETE /ledger truncates the shared cross-consumer ledger on the server, so the
 * Live feed resets to empty AND stays empty across a browser refresh (the SSE replays the file on
 * reconnect). Best-effort: a failure is swallowed by the caller — clearing observability must never
 * throw into the UI.
 */
export async function clearLedger(baseUrl = ''): Promise<void> {
  await fetch(`${baseUrl}/ledger`, { method: 'DELETE' })
}
