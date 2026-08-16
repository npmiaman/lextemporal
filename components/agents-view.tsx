'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { SuggestionCard, shortStage, toneOf, type AgentCard } from '@/components/agent-card'
import type { SessionSummary } from '@/components/sidebar'

type LifecycleStep = { id: string; title: string; status: string; summary?: string; outputs?: string[] }

type ResearchRun = {
  sessionId: number
  stage: string
  status: 'running' | 'failed' | 'stopped'
  currentStep?: { title?: string; summary?: string; outputs?: string[]; reasoningSummary?: string }
  lifecycle?: LifecycleStep[]
}

type BuildJob = {
  jobId: number
  sessionId: number
  slug: string
  brief?: string
  agentMode?: string
  lines: string[]
  route?: string
}

function researchCards(run: ResearchRun, name: string, open: () => void): AgentCard[] {
  const lifecycle = run.lifecycle ?? []
  const runningIndex = lifecycle.findIndex((step) => step.status === 'running' || step.status === 'waiting')
  const index = runningIndex >= 0 ? runningIndex : lifecycle.map((step) => step.status).lastIndexOf('completed')
  const current = index >= 0 ? lifecycle[index] : undefined
  const previous = index > 0 ? lifecycle[index - 1] : undefined
  const failed = run.status === 'failed'
  const stopped = run.status === 'stopped'
  const base = {
    // A paused run reads as paused. Labelling an interruption "Failed" made
    // every stopped crawl look like broken work.
    lead: failed ? 'Pigeon stopped while updating' : stopped ? 'Pigeon paused' : 'Pigeon is updating',
    chip: name,
    chipKind: 'research' as const,
    onChip: open,
    accept: { label: stopped || failed ? 'Resume' : 'Open', onClick: open },
    note: failed ? 'Failed' : stopped ? 'Paused' : undefined,
  }
  const cards: AgentCard[] = []
  if (current && previous) {
    cards.push({
      ...base,
      id: `research-${run.sessionId}-stage-${current.id}`,
      variant: 'transition',
      field: 'stage',
      from: { label: shortStage(previous.id, previous.title), tone: toneOf(previous.status) },
      to: { label: shortStage(current.id, current.title), tone: failed ? 'error' : stopped ? 'idle' : toneOf(current.status) },
    })
  }
  const summary = run.currentStep?.summary ?? current?.summary ?? ''
  const outputs = (run.currentStep?.outputs ?? current?.outputs ?? []).filter(Boolean)
  const reasoning = run.currentStep?.reasoningSummary
  if (current && (summary || outputs.length)) {
    cards.push({
      ...base,
      id: `research-${run.sessionId}-findings-${current.id}`,
      variant: 'diff',
      field: 'findings',
      summary: summary || run.stage.replaceAll('_', ' '),
      heading: run.currentStep?.title ?? current.title,
      items: [...outputs, ...(reasoning ? [reasoning] : [])],
      onViewDiff: open,
    })
  }
  if (cards.length === 0 && current) {
    cards.push({
      ...base,
      id: `research-${run.sessionId}-stage-${current.id}`,
      variant: 'transition',
      field: 'stage',
      from: { label: 'Queued', tone: 'idle' },
      to: { label: shortStage(current.id, current.title), tone: failed ? 'error' : stopped ? 'idle' : 'active' },
    })
  }
  return cards
}

function buildCard(job: BuildJob, name: string): AgentCard {
  const lines = job.lines.map((line) => line.trim()).filter(Boolean)
  return {
    id: `build-${job.jobId}`,
    lead: 'Pigeon is building an app',
    chipKind: 'code',
    variant: 'entity',
    title: job.brief?.trim() || `Build ${job.slug}`,
    status: { label: 'In progress', tone: 'active' },
    badge: { label: job.agentMode === 'code' ? 'Code' : 'Build', tone: job.agentMode === 'code' ? 'error' : 'done' },
    meter: `${lines.length} step${lines.length === 1 ? '' : 's'} logged`,
    initial: (name.trim()[0] ?? 'P').toUpperCase(),
    body: lines.slice(-4),
  }
}

export function AgentsView({
  sessions,
  onOpenSession,
  onOpenRoute,
}: {
  sessions: SessionSummary[]
  onOpenSession: (id: number) => void
  onOpenRoute?: (url: string) => void
}) {
  const [cards, setCards] = useState<AgentCard[]>([])
  const [dismissed, setDismissed] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const mounted = useRef(true)
  const sessionNames = useMemo(
    () => new Map(sessions.map((session) => [session.id, session.name?.trim() || 'Untitled agent'])),
    [sessions],
  )

  const load = useCallback(async () => {
    try {
      // LexTemporal has no build queue; the equivalent "what has the agent been
      // doing" signal is the append-only audit log.
      const auditResponse = await fetch('/api/audit', { cache: 'no-store' })
      const audit = (await auditResponse.json()) as { rows?: { id: number; action: string; object: string; ts: string }[] }
      const research: { runs?: ResearchRun[] } = {}
      const builds: { jobs?: BuildJob[] } = {}
      void audit
      if (!mounted.current) return
      const open = (sessionId: number, route?: string) => () => {
        if (route && onOpenRoute) onOpenRoute(route)
        else onOpenSession(sessionId)
      }
      const hide = (id: string) => setDismissed((prev) => [...prev, id])
      const next: AgentCard[] = [
        ...(research.runs ?? []).flatMap((run) =>
          researchCards(run, sessionNames.get(run.sessionId) ?? 'Untitled agent', open(run.sessionId)).map((card) => ({
            ...card,
            dismiss: { label: 'Dismiss', onClick: () => hide(card.id) },
          })),
        ),
        ...(builds.jobs ?? []).map((job) => {
          const card = buildCard(job, sessionNames.get(job.sessionId) ?? 'Pigeon')
          card.accept = { label: 'Open', onClick: open(job.sessionId, job.route) }
          card.dismiss = {
            label: 'Stop',
            onClick: () => {
              hide(card.id)
              void fetch(`/api/build/job/${job.jobId}/stop`, { method: 'POST' }).then(() => load())
            },
          }
          return card
        }),
      ]
      // Compact transitions lead, taller artifact cards follow, so rows stay even.
      next.sort((a, b) => (a.variant === 'transition' ? 0 : 1) - (b.variant === 'transition' ? 0 : 1))
      setCards(next)
    } finally {
      if (mounted.current) setLoading(false)
    }
  }, [onOpenRoute, onOpenSession, sessionNames])

  useEffect(() => {
    mounted.current = true
    void load()
    const timer = window.setInterval(() => void load(), 2_000)
    return () => {
      mounted.current = false
      window.clearInterval(timer)
    }
  }, [load])

  const visible = cards.filter((card) => !dismissed.includes(card.id))

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-8 py-10 sm:px-12">
      <div className="mx-auto max-w-[1000px]">
        {loading && visible.length === 0 && (
          // Placeholder cards rather than a spinner, so the grid does not jump
          // when the first real agent lands. Shaped like SuggestionCard: lead
          // line with chip, then the card body.
          <div className="grid grid-cols-1 gap-x-14 gap-y-8 lg:grid-cols-2" aria-label="Loading activity" aria-busy>
            {[0, 1].map((index) => (
              <div key={index} className="min-w-0">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-8 w-40 rounded-md" />
                </div>
                <div className="mt-3 rounded-xl border bg-card p-4">
                  <Skeleton className="h-4 w-[85%]" />
                  <Skeleton className="mt-2.5 h-4 w-[55%]" />
                  <div className="mt-4 space-y-2">
                    <Skeleton className="h-3 w-[92%]" />
                    <Skeleton className="h-3 w-[70%]" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        {!loading && visible.length === 0 && (
          <div className="rounded-xl border border-dashed p-10 text-center">
            <p className="text-sm font-medium">No agents are working right now</p>
            <p className="mt-1 text-xs text-muted-foreground">Research and coding work will appear here as soon as it starts.</p>
          </div>
        )}
        <div className="grid grid-cols-1 gap-x-14 lg:grid-cols-2">
          {visible.map((card, index) => {
            // Rows are two wide, so every card above the final row carries the divider.
            const lastRowStart = visible.length - (visible.length % 2 === 0 ? 2 : 1)
            const classes = ['pb-8']
            if (index >= 2) classes.push('pt-10')
            if (index < lastRowStart) classes.push('border-b border-black/[0.07] dark:border-white/[0.07]')
            return <SuggestionCard key={card.id} card={card} className={classes.join(' ')} />
          })}
        </div>
      </div>
    </div>
  )
}
