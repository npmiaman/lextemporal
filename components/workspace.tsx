'use client'

import { useRef, useState } from 'react'
import { PanelLeft, PanelRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ArtifactPanel, type ArtifactTab } from '@/components/artifact-panel'
import { CourtroomPanel } from '@/components/courtroom-panel'
import { Session, type SessionState } from '@/components/session'
import type { Artifact } from '@/lib/workspace'
import type { Hearing } from '@/lib/courtroom'
import { emptyState, type Chat, type ChatState } from '@/lib/chats'

/**
 * The working surface: research session on the left, the drafted document on
 * the right. Same split the coding dashboard used for its embedded browser —
 * what changes is what occupies the right-hand panel, because the thing being
 * produced here is a brief rather than a running app.
 */
export function Workspace({
  chat,
  onState,
  showArtifacts,
  sidebarCollapsed,
  onExpandSidebar,
}: {
  chat: Chat | null
  onState: (state: ChatState) => void
  /** Bumped by the sidebar's Artifacts button to bring the panel forward. */
  showArtifacts?: number
  sidebarCollapsed: boolean
  onExpandSidebar: () => void
}) {
  const initial = chat?.state ?? emptyState()
  const [panelOpen, setPanelOpen] = useState(true)
  const [tabs, setTabs] = useState<ArtifactTab[]>(initial.tabs)
  const [activeId, setActiveId] = useState(initial.tabs[0]?.id ?? '')
  // The right panel holds two kinds of work product: the draft being written and
  // the hearing being simulated against it.
  const [view, setView] = useState<'draft' | 'hearing'>('draft')
  const [hearing, setHearing] = useState<Hearing | null>(initial.hearing)

  // The transcript half of the chat state lives in Session; this keeps the last
  // report of it so a change to the panels can be persisted without waiting for
  // the next message.
  const fromSession = useRef<SessionState>({
    messages: initial.messages,
    docs: initial.docs,
    authorities: initial.authorities,
  })

  const persist = (next: Partial<ChatState>) =>
    onState({ ...fromSession.current, tabs, hearing, ...next })

  // The sidebar's Artifacts entry opens the drafts this matter has produced;
  // they are stored with the chat, so an old matter still has its brief. Derived
  // during render rather than in an effect — the same pattern the sidebar uses
  // for its history cursor, and it avoids a second render pass.
  const [lastShow, setLastShow] = useState(showArtifacts)
  if (showArtifacts !== lastShow) {
    setLastShow(showArtifacts)
    setView('draft')
    setPanelOpen(true)
  }

  const artifacts: Artifact[] = tabs.map((t) => ({
    id: t.id,
    label: t.label,
    kind: 'arguments',
    version: t.version,
    history: [],
    updatedAt: '',
  }))

  const upsert = (tab: ArtifactTab) => {
    // A re-draft of the same artifact bumps its version rather than appearing as
    // a second tab with v1 next to the first.
    const at = tabs.findIndex((t) => t.id === tab.id)
    const next = at === -1 ? [...tabs, tab] : tabs.map((t, i) => (i === at ? { ...tab, version: t.version + 1 } : t))
    setTabs(next)
    setActiveId(tab.id)
    setView('draft')
    setPanelOpen(true)
    persist({ tabs: next })
  }

  return (
    <div className="flex min-w-0 flex-1">
      <main className="relative flex min-w-[380px] flex-1 flex-col overflow-hidden">
        <div className="flex items-center px-3 pt-3">
          {sidebarCollapsed && (
            <Button variant="ghost" size="icon-sm" aria-label="Open sidebar" onClick={onExpandSidebar}>
              <PanelLeft className="text-muted-foreground" />
            </Button>
          )}
          <div className="ml-auto flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Toggle document panel"
              onClick={() => setPanelOpen((v) => !v)}
              className={panelOpen ? 'bg-accent text-accent-foreground' : undefined}
            >
              <PanelRight className="text-muted-foreground" />
            </Button>
          </div>
        </div>

        <Session
          initial={{ messages: initial.messages, docs: initial.docs, authorities: initial.authorities }}
          artifacts={artifacts}
          onArtifact={upsert}
          onHearing={(h) => {
            setHearing(h)
            setView('hearing')
            setPanelOpen(true)
            persist({ hearing: h })
          }}
          onState={(s) => {
            fromSession.current = s
            persist({})
          }}
        />
      </main>

      {panelOpen && (
        <aside className="relative flex w-[42%] min-w-[400px] shrink-0 flex-col border-l bg-background">
          <div className="flex items-center gap-1 border-b px-2 py-1.5">
            {(['draft', 'hearing'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={`rounded-lg px-2.5 py-1 text-xs capitalize transition-colors ${
                  view === v ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                {v === 'draft' ? 'Draft' : 'Hearing'}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setPanelOpen(false)}
              aria-label="Close panel"
              className="ml-auto rounded-lg px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
            >
              Close
            </button>
          </div>
          <div className="min-h-0 flex-1">
            {view === 'draft' ? (
              <ArtifactPanel
                tabs={tabs.length ? tabs : [{ id: 'draft', label: 'Draft', version: 1, args: [], sources: [], abstentions: [] }]}
                activeId={activeId || 'draft'}
                onActiveChange={setActiveId}
                onClose={() => setPanelOpen(false)}
              />
            ) : (
              <CourtroomPanel hearing={hearing} />
            )}
          </div>
        </aside>
      )}
    </div>
  )
}
