'use client'

import { useMemo, useState } from 'react'
import { FileText, Folder, Monitor, Moon, PanelLeft, Send, Settings, Sun } from 'lucide-react'
import { Command as CommandPrimitive } from 'cmdk'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import type { Appearance } from '@/components/settings-view'
import type { ProjectSummary, SessionSummary } from '@/components/sidebar'
import { relativeAge } from '@/lib/timestamps'
import { cn } from '@/lib/utils'

const filters = ['All', 'Papers', 'Projects', 'Actions', 'Settings'] as const
type Filter = (typeof filters)[number]

function Keys({ keys }: { keys: string[] }) {
  if (keys.length === 0) return null
  return (
    <span data-slot="command-shortcut" className="ml-auto flex items-center gap-1">
      {keys.map((key, index) => (
        <kbd
          key={index}
          className="grid size-5 place-items-center rounded border bg-muted font-sans text-[11px] text-muted-foreground"
        >
          {key}
        </kbd>
      ))}
    </span>
  )
}

export function SearchPalette({
  open,
  onOpenChange,
  sessions,
  projects,
  activeProjectId,
  appearance,
  onSelectSession,
  onSelectProject,
  onNewAgent,
  onOpenArtifacts,
  onOpenSettings,
  onToggleSidebar,
  onAppearanceChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  sessions: SessionSummary[]
  projects: ProjectSummary[]
  activeProjectId: number | null
  appearance: Appearance
  onSelectSession: (id: number) => void
  onSelectProject: (id: number) => void
  onNewAgent: () => void
  onOpenArtifacts: () => void
  onOpenSettings: () => void
  onToggleSidebar: () => void
  onAppearanceChange: (next: Appearance) => void
}) {
  const [filter, setFilter] = useState<Filter>('All')
  // Reset the filter each time the palette opens. Adjusted during render rather
  // than in an effect, because the parent can open the palette by shortcut
  // without routing through onOpenChange.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setFilter('All')
  }

  const projectNames = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects],
  )

  // `sessions` is already ordered newest-first by the store. Ages are computed
  // when the palette opens so a long-lived tab does not show stale ones.
  const recentArtifacts = useMemo(
    () => (open ? sessions.slice(0, 8).map((session) => ({
      id: session.id,
      title: session.name?.trim() || 'Untitled agent',
      project: projectNames.get(session.project_id) ?? '',
      age: relativeAge(session.updated_at),
    })) : []),
    [open, sessions, projectNames],
  )

  const run = (action: () => void) => () => {
    onOpenChange(false)
    action()
  }

  const actions = [
    { key: 'new-agent', title: 'New Agent', icon: Send, keys: [], onSelect: run(onNewAgent) },
    { key: 'artifacts', title: 'Open Artifacts', icon: FileText, keys: [], onSelect: run(onOpenArtifacts) },
    { key: 'sidebar', title: 'Toggle sidebar', icon: PanelLeft, keys: [], onSelect: run(onToggleSidebar) },
  ]

  const settingsActions = [
    { key: 'settings', title: 'Open Settings', icon: Settings, hint: '', onSelect: run(onOpenSettings) },
    { key: 'theme-dark', title: 'Theme: Dark', icon: Moon, hint: appearance === 'dark' ? 'Current' : '', onSelect: run(() => onAppearanceChange('dark')) },
    { key: 'theme-light', title: 'Theme: Light', icon: Sun, hint: appearance === 'light' ? 'Current' : '', onSelect: run(() => onAppearanceChange('light')) },
    { key: 'theme-system', title: 'Theme: System', icon: Monitor, hint: appearance === 'system' ? 'Current' : '', onSelect: run(() => onAppearanceChange('system')) },
  ]

  const showArtifacts = filter === 'All' || filter === 'Papers'
  const showProjects = filter === 'All' || filter === 'Projects'
  const showActions = filter === 'All' || filter === 'Actions'
  const showSettings = filter === 'All' || filter === 'Settings'

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search"
      description="Search agents, projects, and actions"
      className="top-[20%] p-0 sm:max-w-3xl"
      showCloseButton={false}
    >
      {/* CommandDialog is only a Dialog shell in this shadcn variant - the cmdk
          <Command> root has to be provided here or its parts have no store. */}
      <Command>
        {/* Borderless oversized input, like the reference - the boxed
            CommandInput from ui/command.tsx is deliberately not used. */}
        <CommandPrimitive.Input
          autoFocus
          placeholder="Search agents, projects, actions..."
          className="w-full bg-transparent px-4 pt-4 pb-2.5 text-base outline-none placeholder:text-muted-foreground/50"
        />

        <div className="flex items-center gap-2 px-4 pb-2">
          {filters.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setFilter(option)}
              className={cn(
                'rounded-md px-2.5 py-0.5 text-[13px] transition-colors',
                option === filter
                  ? 'bg-accent font-medium text-accent-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {option}
            </button>
          ))}
        </div>

        <CommandList className="max-h-[26rem] px-1 pb-1">
          <CommandEmpty>No results found.</CommandEmpty>

          {showArtifacts && recentArtifacts.length > 0 && (
            <CommandGroup heading="Recent artifacts">
              {recentArtifacts.map((agent) => (
                <CommandItem
                  key={agent.id}
                  // cmdk keys selection off `value`, so two untitled agents in
                  // one project would highlight together without the id.
                  value={`${agent.title} ${agent.project} #${agent.id}`}
                  onSelect={run(() => onSelectSession(agent.id))}
                  className="py-2.5 text-[15px]"
                >
                  {agent.title}
                  <span
                    data-slot="command-shortcut"
                    className="ml-auto flex items-center gap-4 text-[13px] text-muted-foreground"
                  >
                    <span>{agent.project}</span>
                    <span className="w-8 text-right tabular-nums">{agent.age}</span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {showProjects && projects.length > 0 && (
            <CommandGroup heading="Projects">
              {projects.map((project) => (
                <CommandItem
                  key={project.id}
                  value={`project ${project.name}`}
                  onSelect={run(() => onSelectProject(project.id))}
                  className="py-2.5 text-[15px]"
                >
                  <Folder className="size-4 text-muted-foreground" />
                  {project.name}
                  {project.id === activeProjectId && (
                    <span data-slot="command-shortcut" className="ml-auto text-[13px] text-muted-foreground">
                      Current
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {showActions && (
            <CommandGroup heading="Agent">
              {actions.map((action) => (
                <CommandItem key={action.key} value={action.title} onSelect={action.onSelect} className="py-2.5 text-[15px]">
                  <action.icon className="size-4 text-muted-foreground" />
                  {action.title}
                  <Keys keys={action.keys} />
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {showSettings && (
            <CommandGroup heading="Settings">
              {settingsActions.map((action) => (
                <CommandItem key={action.key} value={action.title} onSelect={action.onSelect} className="py-2.5 text-[15px]">
                  <action.icon className="size-4 text-muted-foreground" />
                  {action.title}
                  {action.hint && (
                    <span data-slot="command-shortcut" className="ml-auto text-[13px] text-muted-foreground">
                      {action.hint}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>

        <div className="flex items-center gap-4 border-t px-4 py-2.5 text-xs text-muted-foreground">
          <span>↑↓ Select</span>
          <span>↵ Open</span>
          <span>⌘K Toggle search</span>
        </div>
      </Command>
    </CommandDialog>
  )
}
