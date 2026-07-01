import { useState } from 'react'
import { useTraceSocket } from './clients/useTraceSocket'
import { ChatView } from './components/ChatView'
import { LiveListenerTab } from './components/LiveListenerTab'
import { ManualSearchTab } from './components/ManualSearchTab'
import { MockDataBanner } from './components/MockDataBanner'
import { ObservabilityTab } from './components/observability/ObservabilityTab'
import { TracePanel } from './components/TracePanel'
import { API_BASE, WS_BASE } from './lib/config'

type Tab = 'chat' | 'search' | 'observability' | 'live'

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
      <MockDataBanner />
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
          <button
            type="button"
            className={`tab${tab === 'observability' ? ' tab--active' : ''}`}
            onClick={() => setTab('observability')}
          >
            Observability
          </button>
          <button
            type="button"
            className={`tab${tab === 'live' ? ' tab--active' : ''}`}
            onClick={() => setTab('live')}
          >
            Live
          </button>
        </nav>
      </header>
      <div className="layout">
        <div className="layout__main">
          {tab === 'chat' ? (
            <ChatView options={{ baseUrl: API_BASE }} onActiveQuery={setQueryId} />
          ) : tab === 'search' ? (
            <ManualSearchTab baseUrl={API_BASE} />
          ) : tab === 'observability' ? (
            <ObservabilityTab baseUrl={API_BASE} />
          ) : (
            <LiveListenerTab baseUrl={API_BASE} />
          )}
        </div>
        {/* The trace rail is bound to the chat's active queryId — chat-only (search + observability
            render full-width). */}
        {tab === 'chat' ? <TracePanel events={trace.events} status={trace.status} /> : null}
      </div>
    </main>
  )
}
