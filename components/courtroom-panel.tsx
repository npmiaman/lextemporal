'use client'

import { Gavel, Scale, ShieldAlert, UserRound } from 'lucide-react'
import {
  OUTCOME_LABEL,
  PHASE_LABEL,
  PHASE_ORDER,
  ROLE_LABEL,
  type CourtAuthority,
  type Hearing,
  type Phase,
  type Role,
} from '@/lib/courtroom'

const ROLE_ICON: Record<Role, typeof Gavel> = {
  clerk: Scale,
  judge: Gavel,
  plaintiff: UserRound,
  defence: UserRound,
}

/** Counsel are visually opposed; the bench and the clerk sit apart from both. */
const ROLE_STYLE: Record<Role, string> = {
  clerk: 'border-border bg-muted/40 text-muted-foreground',
  judge: 'border-brand/40 bg-brand/10 text-foreground',
  plaintiff: 'border-emerald-500/25 bg-emerald-500/[0.06] text-foreground',
  defence: 'border-destructive/25 bg-destructive/[0.06] text-foreground',
}

const FLAG_DOT: Record<string, string> = {
  green: 'bg-emerald-500',
  amber: 'bg-amber-500',
  red: 'bg-destructive',
  grey: 'bg-muted-foreground',
}

function PhaseRail({ current }: { current: Phase }) {
  const at = PHASE_ORDER.indexOf(current)
  return (
    <ol className="flex items-center gap-1 overflow-x-auto px-3 py-2">
      {PHASE_ORDER.map((p, i) => {
        const state = i < at ? 'done' : i === at ? 'now' : 'todo'
        return (
          <li key={p} className="flex shrink-0 items-center gap-1">
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] whitespace-nowrap transition-colors ${
                state === 'now'
                  ? 'bg-brand text-background font-medium'
                  : state === 'done'
                    ? 'bg-muted text-muted-foreground'
                    : 'text-muted-foreground/50'
              }`}
            >
              {PHASE_LABEL[p]}
            </span>
            {i < PHASE_ORDER.length - 1 && (
              <span className={`h-px w-3 ${i < at ? 'bg-muted-foreground/40' : 'bg-border'}`} />
            )}
          </li>
        )
      })}
    </ol>
  )
}

function AuthorityChip({ a }: { a: CourtAuthority }) {
  return (
    <span
      title={a.reason || a.title}
      className="inline-flex max-w-full items-center gap-1.5 rounded-full border bg-card px-2 py-0.5 text-[11px]"
    >
      <span className={`size-1.5 shrink-0 rounded-full ${FLAG_DOT[a.flag] ?? FLAG_DOT.grey}`} />
      <span className="truncate">{a.citation || a.title.slice(0, 34)}</span>
    </span>
  )
}

/**
 * The court record. A transcript rather than a chat log: turns are attributed to
 * fixed roles in a fixed order, and every authority a speaker leans on is shown
 * with the flag the deterministic engine gave it — so when the defence says a
 * citation is superseded, the reader can see the same red dot the judge sees.
 */
export function CourtroomPanel({
  hearing,
  onResearchWeakPoint,
}: {
  hearing: Hearing | null
  onResearchWeakPoint?: (query: string) => void
}) {
  if (!hearing) {
    return (
      <div className="flex h-full items-center justify-center bg-muted/40 px-6 text-center">
        <div>
          <Gavel className="mx-auto mb-3 size-8 text-muted-foreground/50" />
          <p className="text-sm font-medium text-foreground">No hearing yet</p>
          <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">
            Ask to simulate the hearing. Counsel argue from the authorities actually
            retrieved, and the defence attacks any citation your timeline has superseded.
          </p>
        </div>
      </div>
    )
  }

  const byCnr = new Map(hearing.authorities.map((a) => [a.cnr, a]))

  return (
    <div className="flex h-full flex-col">
      <div className="border-b">
        <PhaseRail current={hearing.phase} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="space-y-3">
          {hearing.turns.map((t) => {
            const Icon = ROLE_ICON[t.role]
            const cited = (t.cites ?? []).map((c) => byCnr.get(c)).filter(Boolean) as CourtAuthority[]
            return (
              <div key={t.id} className={`rounded-xl border px-3 py-2.5 ${ROLE_STYLE[t.role]}`}>
                <div className="mb-1.5 flex items-center gap-1.5">
                  <Icon className="size-3.5 shrink-0" />
                  <span className="text-[11px] font-medium tracking-wide uppercase">
                    {ROLE_LABEL[t.role]}
                  </span>
                  <span className="ml-auto text-[10px] text-muted-foreground">
                    {PHASE_LABEL[t.phase]}
                  </span>
                </div>

                <p className="text-[13.5px] leading-relaxed">{t.text}</p>

                {t.challenge && (
                  <div className="mt-2 flex items-start gap-1.5 rounded-lg border border-destructive/30 bg-destructive/10 px-2.5 py-1.5">
                    <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                    <p className="text-[12px] leading-relaxed text-foreground/90">
                      <span className="font-medium">Citation challenged — </span>
                      {t.challenge.ground}
                    </p>
                  </div>
                )}

                {cited.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {cited.map((a) => (
                      <AuthorityChip key={a.cnr} a={a} />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {hearing.verdict && (
          <div className="mt-4 rounded-xl border border-brand/40 bg-brand/10 p-4">
            <div className="mb-1.5 flex items-center gap-2">
              <Gavel className="size-4 text-brand" />
              <span className="text-sm font-semibold text-foreground">
                {OUTCOME_LABEL[hearing.verdict.outcome]}
              </span>
            </div>
            <p className="text-[13px] leading-relaxed text-foreground/85">
              {hearing.verdict.reasoning}
            </p>
            <p className="mt-2 text-[12px] text-muted-foreground">
              Decisive issue: <span className="text-foreground/80">{hearing.verdict.decisiveIssue}</span>
            </p>
            {hearing.verdict.rejected.length > 0 && (
              <ul className="mt-2 space-y-1">
                {hearing.verdict.rejected.map((r) => (
                  <li key={r.cnr} className="text-[12px] text-muted-foreground">
                    · Declined to rely on {byCnr.get(r.cnr)?.title ?? r.cnr} — {r.ground}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {hearing.weakPoint && (
          <div className="mt-3 rounded-xl border bg-card p-3">
            <p className="text-[12px] font-medium text-foreground">What to fix</p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
              {hearing.weakPoint}
            </p>
            {onResearchWeakPoint && (
              <button
                type="button"
                onClick={() => onResearchWeakPoint(hearing.weakPoint!)}
                className="mt-2 rounded-lg border px-2.5 py-1 text-[12px] text-foreground/80 transition-colors hover:bg-muted"
              >
                Research this point
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
