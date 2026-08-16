'use client'

import { useEffect, useRef, useState } from 'react'
import { Sidebar, type ProjectSummary, type SessionSummary } from '@/components/sidebar'
import { Workspace } from '@/components/workspace'
import { emptyState, loadChats, saveChats, titleFor, type Chat, type ChatState } from '@/lib/chats'

const ACTIVE_KEY = 'lextemporal-active-chat'

// Date.now() is the id: chats are per-browser, so a collision would need two
// created in the same millisecond, and the list is ordered by it anyway.
const blankChat = (): Chat => ({
  id: Date.now(),
  title: 'New matter',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  state: emptyState(),
})

/**
 * Top-level shell. Pigeon's sidebar listed coding sessions inside projects; here
 * the same list is the lawyer's matters, which is the right unit because a
 * matter carries the timeline every validity flag is measured against.
 */
export function Shell() {
  const [chats, setChats] = useState<Chat[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [showArtifacts, setShowArtifacts] = useState(0)
  // localStorage is read after mount, not during render: reading it during the
  // first render makes the client disagree with the server HTML.
  const hydrated = useRef(false)

  useEffect(() => {
    // Deferred out of the effect body so the restore is a separate render pass
    // rather than a cascading one.
    queueMicrotask(() => {
      const stored = loadChats()
      // There is always exactly one chat in focus. Without that guarantee the
      // first message would create a chat, change the key, and remount the
      // workspace out from under the run that was already in flight.
      const seeded = stored.length ? stored : [blankChat()]
      setChats(seeded)
      const saved = Number(localStorage.getItem(ACTIVE_KEY))
      setActiveId(seeded.some((c) => c.id === saved) ? saved : seeded[0].id)
      hydrated.current = true
    })
  }, [])

  useEffect(() => {
    if (hydrated.current) saveChats(chats)
  }, [chats])

  const select = (id: number | null) => {
    setActiveId(id)
    if (id === null) localStorage.removeItem(ACTIVE_KEY)
    else localStorage.setItem(ACTIVE_KEY, String(id))
  }

  const newChat = () => {
    const chat = blankChat()
    setChats((c) => [chat, ...c])
    select(chat.id)
  }

  const patch = (id: number, state: ChatState) =>
    setChats((all) =>
      all.map((c) => {
        if (c.id !== id) return c
        // The chat takes its name from the first thing the lawyer says — usually
        // the plaint, in which case the filing number is the name.
        const first = state.messages.find((m) => m.role === 'user')?.text
        const title = c.title === 'New matter' && first ? titleFor(first) : c.title
        return { ...c, title, state, updatedAt: new Date().toISOString() }
      }),
    )

  const active = chats.find((c) => c.id === activeId) ?? null

  const sessions: SessionSummary[] = chats.map((c) => ({
    id: c.id,
    name: c.title,
    project_id: 0,
    updated_at: c.updatedAt,
  }))
  const projects: ProjectSummary[] = [{ id: 0, name: 'Matters', updated_at: '' }]

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar
        sessions={sessions}
        projects={projects}
        activeProjectId={0}
        activeId={activeId}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((c) => !c)}
        onSelect={(id) => select(id)}
        onSelectProject={() => {}}
        onNew={newChat}
        onArtifacts={() => setShowArtifacts((n) => n + 1)}
        onCreateProject={async () => 'Every matter lives under Matters — start one with New Agent.'}
        onRename={(id, name) => setChats((all) => all.map((c) => (c.id === id ? { ...c, title: name } : c)))}
        onDelete={(id) =>
          setChats((all) => {
            const next = all.filter((c) => c.id !== id)
            if (activeId === id) select(next[0]?.id ?? null)
            return next
          })
        }
      />
      <Workspace
        // Remounting on switch is deliberate: it guarantees no state from the
        // previous matter — papers, authorities, draft — leaks into the next one.
        key={active?.id ?? 'empty'}
        chat={active}
        onState={(state) => active && patch(active.id, state)}
        showArtifacts={showArtifacts}
        sidebarCollapsed={collapsed}
        onExpandSidebar={() => setCollapsed(false)}
      />
    </div>
  )
}
