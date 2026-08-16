'use client'

import Image from 'next/image'
import { ArrowRight, BarChart3, Check, Code2, Search, X } from 'lucide-react'

// One suggestion-feed card: a muted lead line with the subject chip, a bordered
// body that states the change, and an accept/dismiss row. Three body shapes
// cover everything an agent does - a property transition, an artifact it
// created, and a field it rewrote. Shared by the Agents tab and the strip of
// running agents above the conversation so both read as the same surface.

export type Tone = 'idle' | 'active' | 'done' | 'error'

export const TONE: Record<Tone, string> = {
  idle: '#6b6f76',
  active: '#f2c94c',
  done: '#4ea7fc',
  error: '#eb5757',
}

const ACCEPT = '#4cb782'
const DISMISS = '#eb5757'

// Transition rows read like property changes, so stages need short labels
// rather than the full lifecycle sentence used inside the taller cards.
const STAGE_LABEL: Record<string, string> = {
  'first-principles-plan': 'Plan',
  'community-discovery': 'Discovery',
  'community-enrichment': 'Enrichment',
  'relevance-review': 'Relevance',
  'live-verification': 'Verification',
  'top-ten-selection': 'Top ten',
  'deep-research': 'Deep research',
  synthesis: 'Synthesis',
  'lead-magnets': 'Lead magnets',
  'coding-handoff': 'Handoff',
}

export function shortStage(id: string | undefined, title: string): string {
  return (id && STAGE_LABEL[id]) || title.split(' ').slice(0, 2).join(' ')
}

export const toneOf = (status?: string): Tone =>
  status === 'completed' ? 'done' : status === 'running' ? 'active' : status === 'failed' ? 'error' : 'idle'

export type Pill = { label: string; tone: Tone }
export type CardAction = { label: string; onClick: () => void }

export type AgentCard = {
  id: string
  lead: string
  chip?: string
  chipKind?: 'research' | 'code'
  onChip?: () => void
  accept?: CardAction
  dismiss?: CardAction
  /** Rendered in place of the actions, in the muted "no longer actionable" style. */
  note?: string
} & (
  | { variant: 'transition'; field: string; from?: Pill; to: Pill }
  | { variant: 'diff'; field: string; summary: string; heading: string; items: string[]; onViewDiff?: () => void }
  | {
      variant: 'entity'
      title: string
      status: Pill
      badge: Pill
      meter: string
      initial: string
      body: string[]
    }
)

export function SuggestionCard({ card, className, showLogo }: { card: AgentCard; className?: string; showLogo?: boolean }) {
  return (
    <div className={`min-w-0 ${className ?? ''}`}>
      <CardHeader card={card} showLogo={showLogo} />
      <CardBody card={card} />
      <CardActions card={card} />
    </div>
  )
}

function CardHeader({ card, showLogo }: { card: AgentCard; showLogo?: boolean }) {
  const Icon = card.chipKind === 'code' ? Code2 : Search
  return (
    <div className="flex min-w-0 items-center gap-2 text-[15px] text-muted-foreground">
      {/* Pigeon's mark, so the lead line reads as Pigeon speaking. Opt-in: the
          Agents tab is already a wall of Pigeon cards and repeating it there
          adds nothing. */}
      {showLogo && (
        <Image
          src="/workwithpigeon_logo.png"
          alt=""
          width={20}
          height={20}
          unoptimized
          className="size-5 shrink-0 [image-rendering:pixelated]"
        />
      )}
      <span className="shrink-0">{card.lead}</span>
      {card.chip && (
        <button
          onClick={card.onChip}
          disabled={!card.onChip}
          title={card.chip}
          className="inline-flex h-8 min-w-0 max-w-[240px] items-center gap-1.5 rounded-md bg-neutral-100 px-1.5 transition-colors enabled:hover:bg-neutral-200 dark:bg-white/[0.09] dark:enabled:hover:bg-white/[0.14]"
        >
          {card.chipKind === 'code' ? (
            <span className="grid size-[18px] shrink-0 place-items-center rounded-[5px] bg-neutral-300 text-neutral-700 dark:bg-white/25 dark:text-white">
              <Icon className="size-3" strokeWidth={2.5} />
            </span>
          ) : (
            // Research here means Reddit, so the source is named outright
            // rather than left as a generic magnifying glass.
            <Image
              src="/reddit-logo.png"
              alt="Reddit"
              width={18}
              height={18}
              unoptimized
              className="size-[18px] shrink-0 rounded-[5px]"
            />
          )}
          <span className="truncate text-[15px] font-medium text-foreground">{card.chip}</span>
        </button>
      )}
    </div>
  )
}

function Dot({ tone }: { tone: Tone }) {
  return <span className="size-2.5 shrink-0 rounded-full" style={{ background: TONE[tone] }} />
}

function CardBody({ card }: { card: AgentCard }) {
  if (card.variant === 'transition') {
    return (
      <div
        title={card.from ? `${card.from.label} → ${card.to.label}` : card.to.label}
        className="mt-2.5 flex min-w-0 items-center gap-2 overflow-hidden rounded-lg border border-black/10 px-3.5 py-3 text-[15px] dark:border-white/10"
      >
        {card.from ? (
          <>
            <span className="shrink-0 text-muted-foreground">Change</span>
            <span className="shrink-0 font-medium text-foreground">{card.field}</span>
            <span className="shrink-0 text-muted-foreground">from</span>
            <Dot tone={card.from.tone} />
            <span className="min-w-0 truncate text-foreground">{card.from.label}</span>
            <ArrowRight className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
            <Dot tone={card.to.tone} />
            <span className="min-w-0 truncate text-foreground">{card.to.label}</span>
          </>
        ) : (
          <>
            <Dot tone={card.to.tone} />
            <span className="min-w-0 truncate text-foreground">{card.to.label}</span>
          </>
        )}
      </div>
    )
  }

  if (card.variant === 'diff') {
    return (
      <div className="mt-2.5 h-[196px] overflow-hidden rounded-lg border border-black/10 bg-black/[0.02] px-3.5 py-3 dark:border-white/10 dark:bg-white/[0.02]">
        <div className="[mask-image:linear-gradient(to_bottom,black_60%,transparent_100%)]">
          <div className="flex items-baseline justify-between gap-3 text-[15px]">
            <p className="min-w-0 truncate">
              <span className="text-muted-foreground">Change </span>
              <span className="font-medium text-foreground">{card.field}</span>
            </p>
            <button
              onClick={card.onViewDiff}
              disabled={!card.onViewDiff}
              className="shrink-0 text-muted-foreground transition-colors enabled:hover:text-foreground"
            >
              View diff
            </button>
          </div>
          <p className="mt-2 line-clamp-2 text-[15px] italic text-foreground/90">{card.summary}</p>
          <h3 className="mt-3 text-[17px] font-medium leading-6 text-foreground">{card.heading}</h3>
          <ol className="mt-2 space-y-1.5">
            {card.items.map((item, index) => (
              <li key={`${item}-${index}`} className="flex gap-2 text-[15px] leading-6 text-muted-foreground">
                <span className="shrink-0">{index + 1}.</span>
                <span className="line-clamp-2">{item}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    )
  }

  return (
    <div className="mt-2.5 h-[248px] overflow-hidden rounded-lg border border-black/10 bg-black/[0.02] px-4 py-4 shadow-[0_1px_2px_rgba(0,0,0,0.16)] dark:border-white/10 dark:bg-white/[0.03]">
      <div className="[mask-image:linear-gradient(to_bottom,black_62%,transparent_100%)]">
        <h2 className="line-clamp-2 text-[19px] font-medium leading-7 tracking-[-0.01em] text-foreground">{card.title}</h2>
        <div className="mt-3 flex items-center gap-2">
          <span className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-black/10 px-2.5 text-[14px] text-foreground dark:border-white/15">
            <Dot tone={card.status.tone} />
            {card.status.label}
          </span>
          <span
            title={card.meter}
            className="inline-flex h-8 items-center rounded-lg border border-black/10 px-2 text-muted-foreground dark:border-white/15"
          >
            <BarChart3 className="size-4" strokeWidth={2} />
          </span>
          <span className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-black/10 px-2.5 text-[14px] text-foreground dark:border-white/15">
            <Dot tone={card.badge.tone} />
            {card.badge.label}
          </span>
          <span className="grid size-[26px] place-items-center rounded-full bg-violet-500/25 text-[11px] font-semibold text-violet-700 ring-1 ring-violet-400/70 dark:text-violet-100">
            {card.initial}
          </span>
        </div>
        <div className="mt-3 space-y-1">
          {card.body.map((line, index) => (
            <p key={`${line}-${index}`} className="line-clamp-2 text-[15px] leading-6 text-muted-foreground">
              {line}
            </p>
          ))}
        </div>
      </div>
    </div>
  )
}

function CardActions({ card }: { card: AgentCard }) {
  if (card.note) {
    return (
      <div className="mt-2.5 flex items-center gap-1.5 text-[15px] text-muted-foreground">
        <X className="size-4" strokeWidth={2.25} />
        {card.note}
      </div>
    )
  }
  if (!card.accept && !card.dismiss) return null
  return (
    <div className="mt-2.5 flex items-center gap-5 text-[15px]">
      {card.accept && (
        <button
          onClick={card.accept.onClick}
          className="inline-flex items-center gap-1.5 transition-opacity hover:opacity-75"
          style={{ color: ACCEPT }}
        >
          <Check className="size-4" strokeWidth={2.5} />
          {card.accept.label}
        </button>
      )}
      {card.dismiss && (
        <button
          onClick={card.dismiss.onClick}
          className="inline-flex items-center gap-1.5 transition-opacity hover:opacity-75"
          style={{ color: DISMISS }}
        >
          <X className="size-4" strokeWidth={2.5} />
          {card.dismiss.label}
        </button>
      )}
    </div>
  )
}
