import { useState } from 'react'
import type { ChatTelemetry } from './clients/useChatStream'
import { useTraceSocket } from './clients/useTraceSocket'
import { ChatView } from './components/ChatView'
import { LiveListenerTab } from './components/LiveListenerTab'
import { ManualSearchTab } from './components/ManualSearchTab'
import { MockDataBanner } from './components/MockDataBanner'
import { ObservabilityTab } from './components/observability/ObservabilityTab'
import { RepoIngestBar } from './components/RepoIngestBar'
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
  const [telemetry, setTelemetry] = useState<ChatTelemetry | null>(null)
  const [sessionKey, setSessionKey] = useState(0)
  const trace = useTraceSocket(tab === 'chat' ? queryId : null, { baseUrl: WS_BASE })

  // Reset the working session: remount the tab views (fresh chat + a re-fetched corpus tree/symbols)
  // and drop the trace. Fired on a repo ingest (the corpus changed — this is what stops the tree from
  // going stale after an ingest) and on the Clear action.
  const resetSession = () => {
    setQueryId(null)
    setTelemetry(null)
    setSessionKey((k) => k + 1)
  }

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
        {/* FTR-5 P4: paste a git repo URL to index it in-app; the active-corpus chip shows what
            chat + search currently run over (TKT-533). */}
        <RepoIngestBar baseUrl={API_BASE} onIngested={resetSession} onClear={resetSession} />
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
        {/* All four tabs stay MOUNTED; only the active one is visible (display:contents keeps the
            active child a direct grid/flex item of layout__main, so its layout is unchanged, while
            the inactive ones are display:none). Switching tabs therefore PRESERVES each tab's state —
            the chat transcript, the manual-search results, and the live feed survive a tab change
            instead of being unmounted and reset. sessionKey still remounts them all on a repo change. */}
        <div className="layout__main" key={sessionKey}>
          <div style={{ display: tab === 'chat' ? 'contents' : 'none' }}>
            <ChatView
              options={{ baseUrl: API_BASE }}
              onActiveQuery={setQueryId}
              onActiveTelemetry={setTelemetry}
            />
          </div>
          <div style={{ display: tab === 'search' ? 'contents' : 'none' }}>
            <ManualSearchTab baseUrl={API_BASE} />
          </div>
          <div style={{ display: tab === 'observability' ? 'contents' : 'none' }}>
            <ObservabilityTab baseUrl={API_BASE} />
          </div>
          <div style={{ display: tab === 'live' ? 'contents' : 'none' }}>
            <LiveListenerTab baseUrl={API_BASE} />
          </div>
        </div>
        {/* The trace rail is bound to the chat's active queryId — chat-only (search + observability
            render full-width). */}
        {tab === 'chat' ? (
          <TracePanel events={trace.events} status={trace.status} telemetry={telemetry} />
        ) : null}
      </div>
    </main>
  )
}
