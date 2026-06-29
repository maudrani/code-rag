import { useState } from 'react'
import { useTraceSocket } from './clients/useTraceSocket'
import { ChatView } from './components/ChatView'
import { ManualSearchTab } from './components/ManualSearchTab'
import { TracePanel } from './components/TracePanel'
import { API_BASE, WS_BASE } from './lib/config'

type Tab = 'chat' | 'search'

/**
 * App shell — the whole UI assembled against the wire (ADR-008). Tabs between the streaming
 * chat (TKT-505/506) and the deterministic manual search (TKT-507); a live trace rail
 * (TKT-507) bound to the chat's active queryId makes the determinism gradient visible. All
 * surfaces talk to API_BASE (TKT-502 mock in dev; `surface` at M1 assembly — one swap point).
 */
export function App() {
  const [tab, setTab] = useState<Tab>('chat')
  const [queryId, setQueryId] = useState<string | null>(null)
  const trace = useTraceSocket(tab === 'chat' ? queryId : null, { baseUrl: WS_BASE })

  return (
    <main>
      <header className="app__header">
        <h1 className="app__title">
          <span>code-rag</span> — ask the codebase
        </h1>
        <p className="app__subtitle">
          Streaming answers grounded in clickable citations · deterministic gradient L0→L5
        </p>
        <nav className="tabs">
          <button
            type="button"
            className={`tab${tab === 'chat' ? ' tab--active' : ''}`}
            onClick={() => setTab('chat')}
          >
            Chat
          </button>
          <button
            type="button"
            className={`tab${tab === 'search' ? ' tab--active' : ''}`}
            onClick={() => setTab('search')}
          >
            Manual search
          </button>
        </nav>
      </header>
      <div className="layout">
        <div className="layout__main">
          {tab === 'chat' ? (
            <ChatView options={{ baseUrl: API_BASE }} onActiveQuery={setQueryId} />
          ) : (
            <ManualSearchTab baseUrl={API_BASE} />
          )}
        </div>
        <TracePanel events={trace.events} status={trace.status} />
      </div>
    </main>
  )
}
