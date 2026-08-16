'use client'

import { useId, useState } from 'react'
import { Check, ChevronDown, X } from 'lucide-react'

export type ActivityStep = {
  id?: string
  title?: string
  summary?: string
  status?: string
  outputs?: string[]
  reasoningSummary?: string
}

/**
 * Circular band glyph that reads as an agent turning something over. A ring of
 * thin bars sits behind a circular mask; a brightness wave sweeps across them
 * on a staggered delay, so the shape reads as one object thinking rather than
 * as N separate bars blinking.
 */
export function AgentThinking({
  size = 34,
  orientation = 'horizontal',
  className = '',
}: {
  size?: number
  orientation?: 'horizontal' | 'vertical'
  className?: string
}) {
  const clipId = useId()
  const bars = 15
  const vertical = orientation === 'vertical'
  // Drawn as SVG clipped to a real circle. A CSS border-radius only rounds the
  // corners of a square box, so full-width bars still read as a rounded square
  // at these sizes; an SVG circle clip pinches the end bars to nothing and
  // gives the sliced-sphere silhouette its actual edge.
  const span = 100 / bars
  const thickness = span * 0.62
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={`shrink-0 ${className}`}
      role="img"
      aria-label="Agent thinking"
    >
      <defs>
        <clipPath id={clipId}>
          <circle cx="50" cy="50" r="50" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <circle cx="50" cy="50" r="50" className="fill-foreground/[0.07]" />
        {Array.from({ length: bars }, (_, index) => {
          const offset = index * span + (span - thickness) / 2
          return (
            <rect
              key={index}
              className="agent-thinking-band fill-foreground"
              x={vertical ? offset : 0}
              y={vertical ? 0 : offset}
              width={vertical ? thickness : 100}
              height={vertical ? 100 : thickness}
              style={{ animationDelay: `${index * 0.085}s` }}
            />
          )
        })}
      </g>
    </svg>
  )
}

/**
 * The agent's own account of what it is doing. Collapsed to a single line by
 * default so a long run does not bury the reply, and dimmed against a rule so
 * it never reads as the answer itself.
 */
export function ThinkingBlock({
  heading,
  body,
  live = false,
  defaultOpen = true,
}: {
  heading: string
  body: string
  live?: boolean
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="text-[13px]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="group flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
        aria-expanded={open}
      >
        <ChevronDown className={`size-3.5 transition-transform duration-200 ${open ? '' : '-rotate-90'}`} />
        <span>{live ? 'Thinking…' : 'Thought process'}</span>
      </button>
      {open && (
        <div className="mt-2 border-l border-border pl-4">
          <p className="font-semibold text-foreground/90">{heading}</p>
          <p className="mt-1.5 leading-relaxed whitespace-pre-line text-muted-foreground">{body}</p>
        </div>
      )}
    </div>
  )
}

type TaskState = 'done' | 'active' | 'pending' | 'failed'

function taskState(status: string | undefined): TaskState {
  if (status === 'completed') return 'done'
  if (status === 'failed') return 'failed'
  if (status === 'running' || status === 'waiting') return 'active'
  return 'pending'
}

/**
 * Checklist of the run's stages. Driven by the same persisted step records the
 * audit trail uses, so it can never show a task the run did not actually reach.
 */
export function TaskChecklist({ steps, label }: { steps: ActivityStep[]; label?: string }) {
  const [open, setOpen] = useState(true)
  if (!steps.length) return null
  const done = steps.filter((step) => taskState(step.status) === 'done').length
  return (
    <div className="overflow-hidden rounded-xl border bg-card/60">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <ListChecks />
        <span className="text-xs font-medium tabular-nums text-muted-foreground">
          {label ? `${label} · ` : ''}{done}/{steps.length} done
        </span>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="ml-auto text-muted-foreground transition-colors hover:text-foreground"
          aria-label={open ? 'Collapse task list' : 'Expand task list'}
        >
          {open ? <X className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </button>
      </div>
      {open && (
        <ul className="divide-y">
          {steps.map((step, index) => {
            const state = taskState(step.status)
            return (
              <li key={step.id ?? index} className="flex items-start gap-2.5 px-3 py-2.5">
                <span className="mt-px flex size-4 shrink-0 items-center justify-center">
                  {state === 'done' ? (
                    <Check className="size-4 text-emerald-500" />
                  ) : state === 'failed' ? (
                    <X className="size-4 text-destructive" />
                  ) : state === 'active' ? (
                    <span className="size-3.5 animate-spin rounded-full border border-dashed border-foreground/60" />
                  ) : (
                    <span className="size-3.5 rounded-full border border-muted-foreground/40" />
                  )}
                </span>
                <span
                  className={`text-[13px] leading-5 ${
                    state === 'done'
                      ? 'text-muted-foreground line-through decoration-muted-foreground/50'
                      : state === 'pending'
                        ? 'text-muted-foreground'
                        : 'font-medium text-foreground'
                  }`}
                >
                  {step.title ?? 'Research step'}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/** One crawler's live state. `opened`/`total` are threads, not communities. */
export type CommunityProgress = {
  community: string
  action: string
  opened?: number
  total?: number
  done?: boolean
}

/**
 * A row per subreddit, because the crawl runs one worker per community and they
 * genuinely progress independently: collapsing them into a single line hid four
 * of the five agents. The counter is the real running total of threads opened.
 */
export function CommunityAgents({ communities }: { communities: CommunityProgress[] }) {
  if (!communities.length) return null
  const read = communities.reduce((total, item) => total + (item.opened ?? 0), 0)
  const known = communities.reduce((total, item) => total + (item.total ?? 0), 0)
  const finished = communities.filter((item) => item.done).length
  return (
    <div className="overflow-hidden rounded-xl border bg-card/60">
      <div className="flex items-center gap-2 border-b px-3 py-2 text-xs text-muted-foreground">
        <span className="font-medium">
          {finished}/{communities.length} communities
        </span>
        <span aria-hidden>·</span>
        <span className="tabular-nums">
          {read.toLocaleString()}{known ? ` of ${known.toLocaleString()}` : ''} posts read
        </span>
      </div>
      <ul className="divide-y">
        {communities.map((item) => {
          const pct = item.total ? Math.min(100, Math.round(((item.opened ?? 0) / item.total) * 100)) : 0
          return (
            <li key={item.community} className="px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="flex size-4 shrink-0 items-center justify-center">
                  {item.done
                    ? <Check className="size-3.5 text-emerald-500" />
                    : <AgentThinking size={13} />}
                </span>
                <span className={`shrink-0 text-[13px] font-medium ${item.done ? 'text-muted-foreground' : 'text-foreground'}`}>
                  r/{item.community}
                </span>
                <span className="truncate text-[13px] text-muted-foreground">{item.action}</span>
                {item.total ? (
                  <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
                    {item.opened ?? 0}/{item.total}
                  </span>
                ) : null}
              </div>
              {item.total ? (
                <div className="mt-1.5 ml-6 h-0.5 overflow-hidden rounded-full bg-foreground/10">
                  <div
                    className="h-full rounded-full bg-foreground/45 transition-[width] duration-500"
                    style={{ width: `${item.done ? 100 : pct}%` }}
                  />
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function ListChecks() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="size-4 text-muted-foreground" aria-hidden>
      <path d="m3 7 2 2 4-4M3 17l2 2 4-4M13 7h8M13 17h8" />
    </svg>
  )
}

/**
 * What the chat body shows while a run is in flight: the current thought, the
 * stage checklist, and the live line from the crawler. Replaces the audit
 * Markdown dump that used to be patched into the message text.
 */
export function AgentActivity({
  steps,
  live,
  running = true,
  communities = [],
}: {
  steps: ActivityStep[]
  live?: { title: string; detail: string }
  /** False once the run has ended — the header must stop claiming to think. */
  running?: boolean
  communities?: CommunityProgress[]
}) {
  const active = steps.find((step) => step.status === 'running' || step.status === 'waiting')
  const current = active ?? steps.at(-1)
  const failed = steps.some((step) => step.status === 'failed')
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        {running ? (
          <AgentThinking />
        ) : (
          <span className="grid size-[34px] shrink-0 place-items-center rounded-full bg-foreground/[0.07]">
            {failed ? <X className="size-4 text-destructive" /> : <Check className="size-4 text-emerald-500" />}
          </span>
        )}
        <div className="min-w-0">
          <p className="text-[15px] font-medium text-foreground">
            {running ? 'Working…' : failed ? 'Finished with problems' : 'Done'}
          </p>
          <p className="truncate text-[13px] text-muted-foreground">
            {live ? `${live.title} — ${live.detail}` : current?.title ?? 'Preparing the research workflow'}
          </p>
        </div>
      </div>

      {running && current?.summary && (
        <ThinkingBlock
          heading={current.title ?? 'Current step'}
          body={[current.summary, current.reasoningSummary].filter(Boolean).join('\n\n')}
          live
        />
      )}

      {/* During the crawl the per-community agents are the useful view; the
          stage checklist is the coarser one, so it sits underneath. */}
      <CommunityAgents communities={communities} />

      <TaskChecklist steps={steps} />
    </div>
  )
}
