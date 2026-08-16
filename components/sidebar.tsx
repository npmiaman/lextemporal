'use client'

import { useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { ArrowLeft, ArrowRight, ChevronDown, ChevronRight, FileText, Folder, FolderPlus, ListFilter, PanelLeft, Pencil, Search, Send, Settings, Trash2 } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { SearchPalette } from '@/components/search-palette'
import { SettingsView, type Appearance } from '@/components/settings-view'
import { usePersistedChoice, usePersistedWidth, writeUiPreference } from '@/lib/ui-preferences'

const APPEARANCE_KEY = 'pigeon-appearance'
const SIDEBAR_WIDTH_KEY = 'pigeon-sidebar-width'

function applyAppearance(appearance: Appearance) {
  const dark = appearance !== 'light'
    && (appearance !== 'system' || window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
}

export interface SessionSummary {
  id: number
  name: string | null
  project_id: number
  updated_at: string
}

export interface ProjectSummary {
  id: number
  name: string
  updated_at: string
}

export function Sidebar({
  sessions,
  projects,
  activeProjectId,
  activeId,
  collapsed,
  onToggleCollapsed,
  onSelect,
  onSelectProject,
  onNew,
  onArtifacts,
  onCreateProject,
  onRename,
  onDelete,
}: {
  sessions: SessionSummary[]
  projects: ProjectSummary[]
  activeProjectId: number | null
  activeId: number | null
  collapsed: boolean
  onToggleCollapsed: () => void
  onSelect: (id: number) => void
  onSelectProject: (id: number) => void
  onNew: () => void
  onArtifacts: () => void
  onCreateProject: (name: string) => Promise<string | null>
  onRename: (id: number, name: string) => void
  onDelete: (id: number) => void
}) {
  const [searchOpen, setSearchOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Reading localStorage during the first render makes the client disagree
  // with the server HTML (hydration mismatch); these render the default on
  // the server and adopt the persisted value right after hydration.
  const appearance = usePersistedChoice<Appearance>(APPEARANCE_KEY, ['light', 'dark', 'system'], 'dark')
  const sidebarWidth = usePersistedWidth(SIDEBAR_WIDTH_KEY, 256, 210, 420)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const [expandedProjects, setExpandedProjects] = useState<Set<number>>(new Set())
  const [collapsedProjects, setCollapsedProjects] = useState<Set<number>>(new Set())


  const createProject = async () => {
    if (projects.length >= 5) {
      window.alert('Free plans can create up to 5 projects.')
      return
    }
    const name = window.prompt('Project name')?.trim()
    if (!name) return
    const error = await onCreateProject(name)
    if (error) window.alert(error)
  }

  const startSidebarResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const move = (pointerEvent: PointerEvent) => {
      const width = Math.min(420, Math.max(210, pointerEvent.clientX))
      writeUiPreference(SIDEBAR_WIDTH_KEY, String(width))
    }
    const stop = () => {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  const commitRename = (id: number, current: string | null) => {
    setEditingId(null)
    const name = draft.trim()
    if (name && name !== (current ?? '')) onRename(id, name)
  }

  // ⌘K / Ctrl+K opens the palette from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setSearchOpen((prev) => !prev)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    const saved = localStorage.getItem(APPEARANCE_KEY) as Appearance | null
    const initial = saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'dark'
    applyAppearance(initial)

    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const syncSystemAppearance = () => {
      if (localStorage.getItem(APPEARANCE_KEY) === 'system') applyAppearance('system')
    }
    media.addEventListener('change', syncSystemAppearance)
    return () => media.removeEventListener('change', syncSystemAppearance)
  }, [])

  const updateAppearance = (next: Appearance) => {
    writeUiPreference(APPEARANCE_KEY, next)
    applyAppearance(next)
  }

  // Back/Forward were decorative: both arrows rendered with no handler. Track
  // the chats actually visited so they navigate. Recorded during render (not in
  // an effect) and skipped when the cursor already points at `activeId`, so
  // pressing Back does not push the destination as a new entry.
  const [visits, setVisits] = useState<{ stack: number[]; cursor: number }>(() =>
    activeId === null ? { stack: [], cursor: -1 } : { stack: [activeId], cursor: 0 },
  )
  const [lastActive, setLastActive] = useState(activeId)
  if (activeId !== lastActive) {
    setLastActive(activeId)
    if (activeId !== null && visits.stack[visits.cursor] !== activeId) {
      const stack = [...visits.stack.slice(0, visits.cursor + 1), activeId].slice(-50)
      setVisits({ stack, cursor: stack.length - 1 })
    }
  }
  const goTo = (cursor: number) => {
    const target = visits.stack[cursor]
    if (target === undefined) return
    setVisits((current) => ({ ...current, cursor }))
    onSelect(target)
  }
  const canGoBack = visits.cursor > 0
  const canGoForward = visits.cursor >= 0 && visits.cursor < visits.stack.length - 1

  // The palette is reachable by ⌘K whether or not the sidebar is showing, so
  // both branches get the same live data and handlers.
  const palette = (
    <SearchPalette
      open={searchOpen}
      onOpenChange={setSearchOpen}
      sessions={sessions}
      projects={projects}
      activeProjectId={activeProjectId}
      appearance={appearance}
      onSelectSession={onSelect}
      onSelectProject={onSelectProject}
      onNewAgent={onNew}
      onOpenArtifacts={onArtifacts}
      onOpenSettings={() => setSettingsOpen(true)}
      onToggleSidebar={onToggleCollapsed}
      onAppearanceChange={updateAppearance}
    />
  )

  if (collapsed) {
    return (
      <>
        {palette}
        {settingsOpen && <SettingsView appearance={appearance} onAppearanceChange={updateAppearance} onClose={() => setSettingsOpen(false)} />}
      </>
    )
  }

  return (
    <aside className="relative flex shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground" style={{ width: sidebarWidth }}>
      <div
        role="separator"
        aria-label="Resize sidebar"
        aria-orientation="vertical"
        onPointerDown={startSidebarResize}
        className="absolute inset-y-0 right-[-3px] z-40 w-1.5 cursor-col-resize transition-colors hover:bg-foreground/10 active:bg-foreground/15"
      />
      <div className="flex items-center justify-between px-3 pt-3">
        <Button variant="ghost" size="icon-sm" aria-label="Collapse sidebar" onClick={onToggleCollapsed}>
          <PanelLeft className="text-muted-foreground" />
        </Button>
        <div className="flex items-center">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Back"
            disabled={!canGoBack}
            onClick={() => goTo(visits.cursor - 1)}
          >
            <ArrowLeft className="text-muted-foreground" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Forward"
            disabled={!canGoForward}
            onClick={() => goTo(visits.cursor + 1)}
          >
            <ArrowRight className="text-muted-foreground" />
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-0.5 px-3 pt-3">
        <Button
          variant="secondary"
          className="h-9 justify-start gap-2.5 bg-sidebar-accent text-sidebar-accent-foreground text-sm font-medium hover:bg-sidebar-accent/70"
          onClick={onNew}
        >
          <Send className="size-4" strokeWidth={1.8} />
          New Agent
        </Button>
        <Button
          variant="ghost"
          className="h-8 justify-start gap-2.5 text-sm text-foreground/80"
          onClick={() => setSearchOpen(true)}
        >
          <Search className="size-4" strokeWidth={1.8} />
          Search
        </Button>
        <Button
          variant="ghost"
          className="h-8 justify-start gap-2.5 text-sm text-foreground/80"
          onClick={onArtifacts}
        >
          <FileText className="size-4" strokeWidth={1.8} />
          Artifacts
        </Button>
      </div>

      <div className="mt-5 flex items-center justify-between pr-2 pl-6">
        <span className="text-sm text-muted-foreground">Projects <span className="text-xs">{projects.length}/5</span></span>
        <div className="flex items-center">
          <Button variant="ghost" size="icon-sm" aria-label="Filter projects">
            <ListFilter className="text-muted-foreground" />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="New project" onClick={() => void createProject()} disabled={projects.length >= 5}>
            <FolderPlus className="text-muted-foreground" />
          </Button>
        </div>
      </div>

      <nav className="mt-1 flex flex-col gap-0.5 overflow-y-auto px-3">
        {projects.map((project) => {
          const projectSessions = sessions.filter((session) => session.project_id === project.id)
          const expanded = !collapsedProjects.has(project.id)
            && (expandedProjects.has(project.id) || activeProjectId === project.id)
          return <div key={project.id} className="mb-0.5">
            <button
              type="button"
              onClick={() => {
                onSelectProject(project.id)
                if (expanded) {
                  setCollapsedProjects((current) => new Set(current).add(project.id))
                } else {
                  setCollapsedProjects((current) => {
                    const next = new Set(current)
                    next.delete(project.id)
                    return next
                  })
                  setExpandedProjects((current) => new Set(current).add(project.id))
                }
              }}
              className={`flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm font-medium hover:bg-sidebar-accent/60 ${activeProjectId === project.id ? 'text-sidebar-foreground' : 'text-sidebar-foreground/80'}`}
            >
              <Folder className="size-4 shrink-0" strokeWidth={1.8} />
              <span className="min-w-0 flex-1 truncate">{project.name}</span>
              {expanded ? <ChevronDown className="size-3.5 text-muted-foreground" /> : <ChevronRight className="size-3.5 text-muted-foreground" />}
            </button>
            {expanded && <div className="ml-5 pl-1.5">
              {projectSessions.length === 0 && <p className="px-3 py-1.5 text-xs text-muted-foreground">No chats yet</p>}
              {projectSessions.map((s) =>
          editingId === s.id ? (
            <div key={s.id} className="flex items-center px-3 py-1.5">
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename(s.id, s.name)
                  if (e.key === 'Escape') setEditingId(null)
                }}
                onBlur={() => commitRename(s.id, s.name)}
                className="w-full rounded-md bg-background px-2 py-1 text-sm ring-1 ring-border outline-none"
              />
            </div>
          ) : (
            <div
              key={s.id}
              role="button"
              tabIndex={0}
              onClick={() => { onSelectProject(project.id); onSelect(s.id) }}
              onKeyDown={(e) => e.key === 'Enter' && onSelect(s.id)}
              className={`group relative flex cursor-pointer items-center rounded-md px-3 py-1.5 text-sm ${
                s.id === activeId
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/60'
              }`}
            >
              <span className="min-w-0 flex-1 truncate text-left">{s.name ?? 'Untitled agent'}</span>
              <span className="pointer-events-none absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1 rounded bg-sidebar-accent pl-1 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
                <button
                  type="button"
                  aria-label="Rename agent"
                  onClick={(e) => {
                    e.stopPropagation()
                    setEditingId(s.id)
                    setDraft(s.name ?? '')
                  }}
                  className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                >
                  <Pencil className="size-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="Delete agent"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (window.confirm('Delete this agent and all its messages?')) onDelete(s.id)
                  }}
                  className="rounded p-0.5 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </span>
            </div>
          ))}
            </div>}
          </div>
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-3 p-3">
        <div className="flex items-center gap-2 px-1 pb-1">
          <Avatar className="size-7">
            <AvatarFallback className="bg-sidebar-accent text-sidebar-accent-foreground text-xs font-medium">A</AvatarFallback>
          </Avatar>
          <div className="flex flex-col">
            <span className="text-xs leading-tight font-medium">Aman Pandit</span>
            <span className="text-xs leading-tight text-muted-foreground">Free Plan</span>
          </div>
          <Button variant="ghost" size="icon-sm" className="ml-auto" aria-label="Settings" onClick={() => setSettingsOpen(true)}>
            <Settings className="text-muted-foreground" />
          </Button>
        </div>
      </div>

      {palette}
      {settingsOpen && <SettingsView appearance={appearance} onAppearanceChange={updateAppearance} onClose={() => setSettingsOpen(false)} />}
    </aside>
  )
}
