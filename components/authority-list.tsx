'use client'

import type { FlaggedAuthority } from '@/lib/workspace'

/**
 * The retrieved authorities, with the validity flag carried by the COLOUR of the
 * rule down the left of each row rather than by a word in the prose.
 *
 * The engine's labels are red/amber/green/grey, and having the answer spell them
 * out made the reader learn a legend before they could read a sentence — and
 * invited the model to write "the flag remains AMBER" as if that were legal
 * analysis. The colour is the flag; the text beside it says what it means in
 * words a lawyer already uses.
 */
const STATUS: Record<string, { line: string; dot: string; label: string }> = {
  red: {
    line: 'border-l-destructive',
    dot: 'bg-destructive',
    label: 'Cannot be cited as it stands',
  },
  amber: {
    line: 'border-l-amber-500',
    dot: 'bg-amber-500',
    label: 'Citation needs updating',
  },
  green: {
    line: 'border-l-emerald-500',
    dot: 'bg-emerald-500',
    label: 'No superseding amendment found',
  },
  grey: {
    line: 'border-l-muted-foreground/40',
    dot: 'bg-muted-foreground/60',
    label: 'Not checked — outside the verified statute graph',
  },
}

const ORDER: Record<string, number> = { red: 0, amber: 1, green: 2, grey: 3 }

export function AuthorityList({ authorities }: { authorities: FlaggedAuthority[] }) {
  if (!authorities.length) return null
  // Worst first: what cannot be filed is what the lawyer needs to see, and a
  // scroll to reach it is a scroll too many.
  const rows = [...authorities].sort((a, b) => (ORDER[a.color] ?? 9) - (ORDER[b.color] ?? 9))

  return (
    <div className="mt-4">
      <p className="mb-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {authorities.length} authorit{authorities.length === 1 ? 'y' : 'ies'} retrieved
      </p>
      <ul className="space-y-1.5">
        {rows.map((a) => {
          const s = STATUS[a.color] ?? STATUS.grey
          const actionable = a.color === 'red' || a.color === 'amber'
          return (
            <li
              key={a.cnr}
              className={`rounded-r-md border-l-[3px] bg-card/40 py-1.5 pr-3 pl-3 ${s.line}`}
            >
              <div className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
                  {a.title}
                </span>
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{a.date}</span>
              </div>
              <div className="mt-0.5 flex items-center gap-1.5">
                <span className={`size-1.5 shrink-0 rounded-full ${s.dot}`} />
                <span className="text-[11.5px] text-muted-foreground">{s.label}</span>
                {a.citation && (
                  <span className="ml-auto truncate text-[11px] text-muted-foreground/70">{a.citation}</span>
                )}
              </div>
              {/* Only a flag that changes what gets filed earns the full reason. */}
              {actionable && a.reason && (
                <p className="mt-1 text-[11.5px] leading-relaxed text-foreground/70">{a.reason}</p>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
