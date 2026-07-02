/**
 * QueryLedger — a tiny newest-first ring of query ids, the shape the cross-consumer
 * ledger builds on. A REAL fixture symbol (a class + methods) for the E2E smoke to
 * retrieve alongside scoreGate; not the production ledger.
 */
export class QueryLedger {
  private readonly ids: string[] = []

  /** record a query id at the front (newest-first). */
  record(queryId: string): void {
    this.ids.unshift(queryId)
  }

  /** the most recent `limit` ids. */
  recent(limit: number): string[] {
    return this.ids.slice(0, limit)
  }
}
