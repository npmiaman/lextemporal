'use client'

import { useState, type PointerEvent as ReactPointerEvent } from 'react'
import { AlertTriangle, CheckCircle2, CircleHelp, FileText, History, OctagonAlert, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { usePersistedWidth, writeUiPreference } from '@/lib/ui-preferences'
import type { DraftedArgument, DraftSource } from '@/lib/drafting'

const PANEL_WIDTH_KEY = 'lextemporal-artifact-width'

export interface ArtifactTab {
  id: string
  label: string
  version: number
  args: DraftedArgument[]
  sources: DraftSource[]
  abstentions: string[]
}

const FLAG_ICON = { green: CheckCircle2, amber: AlertTriangle, red: OctagonAlert, grey: CircleHelp } as const
const FLAG_STYLE: Record<string, string> = {
  green: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
  amber: 'text-amber-400 border-amber-500/30 bg-amber-500/10',
  red: 'text-destructive border-destructive/30 bg-destructive/10',
  grey: 'text-muted-foreground border-border bg-muted/50',
}
/** The colour carries the flag; the words say what it means, not what it is called. */
const FLAG_LABEL: Record<string, string> = {
  green: 'no amendment found',
  amber: 'needs updating',
  red: 'superseded',
  grey: 'not checked',
}

/** Split drafted prose into its sentences and their [dN¶M] citation tags. */
function segments(text: string): { text: string; tag?: string; para?: number }[] {
  const out: { text: string; tag?: string; para?: number }[] = []
  const re = /(.*?)\[(d\d+)¶(\d+)\]\s*/g
  let last = 0
  for (const m of text.matchAll(re)) {
    out.push({ text: m[1].trim(), tag: m[2], para: Number(m[3]) })
    last = (m.index ?? 0) + m[0].length
  }
  const tail = text.slice(last).trim()
  if (tail) out.push({ text: tail })
  return out
}

/**
 * The right-hand panel. Where the coding dashboard put an embedded browser,
 * a legal workspace puts the work product: the drafted arguments, building as
 * they are written, with every sentence traceable to the judgment paragraph it
 * rests on. The chrome is deliberately the same — tab strip, toolbar, resizable
 * edge — because the mental model is the same: this is the thing you are making,
 * kept beside the conversation that is making it.
 */
export function ArtifactPanel({
  tabs,
  activeId,
  onActiveChange,
  onClose,
  onCite,
}: {
  tabs: ArtifactTab[]
  activeId: string
  onActiveChange: (id: string) => void
  onClose: () => void
  onCite?: (tag: string, para: number) => void
}) {
  const [showSources, setShowSources] = useState(false)
  const panelWidth = usePersistedWidth(PANEL_WIDTH_KEY, 560, 380, 960)
  // The paragraph behind whichever citation was last clicked. This is the claim
  // the draft makes about itself, so checking it has to cost one click.
  const [pin, setPin] = useState<{
    tag: string
    para: number
    title: string
    text: string | null
    error?: string
  } | null>(null)

  // Mirrors the browser panel's resize exactly: width is derived from the
  // pointer's distance to the right edge and persisted, so the panel keeps its
  // size across reloads and never squeezes the transcript below 380px.
  const startPanelResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const move = (pointerEvent: PointerEvent) => {
      const maximum = Math.max(380, window.innerWidth - 380)
      const width = Math.min(960, maximum, Math.max(380, window.innerWidth - pointerEvent.clientX))
      writeUiPreference(PANEL_WIDTH_KEY, String(width))
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

  const active = tabs.find((t) => t.id === activeId) ?? tabs[0]

  const openPin = async (tag: string, para: number) => {
    onCite?.(tag, para)
    const source = active?.sources.find((s) => s.tag === tag)
    if (!source) return
    // The papers are the lawyer's own filing, which the server has no copy of —
    // saying which clause is the honest answer, not a fabricated quotation.
    if (source.docid === 'papers') {
      setPin({
        tag,
        para,
        title: source.title,
        text: null,
        error: `Clause ${para} of the papers you put on record. Open your own filing to read it.`,
      })
      return
    }
    setPin({ tag, para, title: source.title, text: null })
    try {
      const res = await fetch(`/api/paragraph?cnr=${encodeURIComponent(source.docid)}&para=${para}`)
      const json = (await res.json()) as { paragraph?: string; error?: string; title?: string }
      setPin({
        tag,
        para,
        title: json.title ?? source.title,
        text: res.ok ? (json.paragraph ?? null) : null,
        error: res.ok ? undefined : json.error,
      })
    } catch (e) {
      setPin({ tag, para, title: source.title, text: null, error: String(e) })
    }
  }

  return (
    <aside className="relative flex shrink-0 flex-col border-l bg-background" style={{ width: panelWidth }}>
      <div
        role="separator"
        aria-label="Resize document panel"
        aria-orientation="vertical"
        onPointerDown={startPanelResize}
        className="absolute inset-y-0 left-[-3px] z-40 w-1.5 cursor-col-resize transition-colors hover:bg-foreground/10 active:bg-foreground/15"
      />

      <div className="flex items-center gap-1 border-b px-2 pt-2">
        <div className="flex min-w-0 flex-1 items-end gap-1 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => onActiveChange(tab.id)}
              className={`group flex max-w-44 min-w-0 items-center gap-1.5 rounded-t-lg border border-b-0 px-2.5 py-1.5 text-xs ${
                active && tab.id === active.id
                  ? 'bg-background font-medium'
                  : 'bg-muted/50 text-muted-foreground hover:bg-muted'
              }`}
            >
              <FileText className="size-3 shrink-0 text-muted-foreground" />
              <span className="truncate">{tab.label}</span>
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground">v{tab.version}</span>
            </button>
          ))}
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Close document panel" onClick={onClose}>
          <X className="text-muted-foreground" />
        </Button>
      </div>

      {active && (
        <div className="flex items-center gap-2 border-b px-3 py-1.5">
          <span className="truncate font-mono text-xs text-muted-foreground">@{active.id}</span>
          <span className="text-xs text-muted-foreground">·</span>
          <span className="text-xs text-muted-foreground">
            {active.args.length} argument{active.args.length === 1 ? '' : 's'}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setShowSources((v) => !v)}>
              {showSources ? 'Hide' : 'Show'} authorities
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Version history">
              <History className="text-muted-foreground" />
            </Button>
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!active || active.args.length === 0 ? (
          <div className="flex h-full items-center justify-center bg-muted/40 px-6 text-center">
            <div>
              <FileText className="mx-auto mb-3 size-8 text-muted-foreground/50" />
              <p className="text-sm font-medium text-foreground">No draft yet</p>
              <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                Ask for arguments and they appear here, every sentence traceable to the
                judgment paragraph it rests on.
              </p>
            </div>
          </div>
        ) : (
          <article className="px-6 py-6">
            {active.args.map((a, i) => (
              <section key={a.id} className="mb-7">
                <div className="mb-2 flex items-center gap-2">
                  <span className="font-mono text-[11px] text-muted-foreground">{a.id}</span>
                  {a.status === 'stale' && (
                    <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400">
                      pending re-verification
                    </span>
                  )}
                  <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                    confidence {(a.confidence * 100).toFixed(0)}%
                  </span>
                </div>
                <p className={`text-[15px] leading-[1.75] text-foreground ${a.status === 'stale' ? 'opacity-40' : ''}`}>
                  {segments(a.text).map((seg, j) => (
                    <span key={j}>
                      {seg.text}{' '}
                      {seg.tag && (
                        <button
                          type="button"
                          onClick={() => void openPin(seg.tag!, seg.para!)}
                          className={`mx-0.5 rounded px-1 py-0.5 align-baseline font-mono text-[10px] transition-colors hover:bg-brand hover:text-background ${
                            pin?.tag === seg.tag && pin?.para === seg.para
                              ? 'bg-brand text-background'
                              : 'bg-secondary text-muted-foreground'
                          }`}
                        >
                          {seg.tag}¶{seg.para}
                        </button>
                      )}{' '}
                    </span>
                  ))}
                </p>
                {i < active.args.length - 1 && <div className="mt-7 h-px bg-border" />}
              </section>
            ))}

            {active.abstentions.length > 0 && (
              <div className="mt-6 rounded-lg border bg-card p-4">
                <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  Not argued — the sources do not support it
                </h3>
                <ul className="space-y-1.5">
                  {active.abstentions.map((t, i) => (
                    <li key={i} className="text-[13px] leading-relaxed text-foreground/80">· {t}</li>
                  ))}
                </ul>
                <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
                  Points the model declined to make rather than invent. Treat them as gaps
                  to fill with better authority.
                </p>
              </div>
            )}

            {showSources && (
              <div className="mt-6 space-y-2">
                <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  Authorities relied on
                </h3>
                {active.sources.map((s) => {
                  const Icon = FLAG_ICON[(s.flagColor as keyof typeof FLAG_ICON) ?? 'grey']
                  return (
                    <div key={s.tag} className="flex items-start gap-3 rounded-lg border bg-card p-3">
                      <span className="mt-0.5 font-mono text-[11px] text-muted-foreground">{s.tag}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] text-foreground">{s.title}</span>
                        <span className="block truncate text-xs text-muted-foreground">{s.court} · {s.date}</span>
                      </span>
                      <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${FLAG_STYLE[s.flagColor] ?? FLAG_STYLE.grey}`}>
                        <Icon className="size-3" />
                        {FLAG_LABEL[s.flagColor] ?? 'not checked'}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </article>
        )}
      </div>

      {/* The source paragraph, docked under the draft rather than in a modal:
          the point is to read the sentence and its authority together. */}
      {pin && (
        <div className="max-h-[38%] shrink-0 overflow-y-auto border-t bg-card/60">
          <div className="sticky top-0 flex items-center gap-2 border-b bg-card/95 px-3 py-1.5 backdrop-blur">
            <span className="font-mono text-[11px] text-brand">{pin.tag}¶{pin.para}</span>
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{pin.title}</span>
            <Button variant="ghost" size="icon-sm" aria-label="Close source" onClick={() => setPin(null)}>
              <X className="text-muted-foreground" />
            </Button>
          </div>
          <div className="px-4 py-3">
            {pin.error ? (
              <p className="text-[12.5px] leading-relaxed text-muted-foreground">{pin.error}</p>
            ) : pin.text == null ? (
              <p className="text-[12.5px] text-muted-foreground">Loading the paragraph…</p>
            ) : (
              <p className="text-[13px] leading-[1.65] whitespace-pre-wrap text-foreground/85">{pin.text}</p>
            )}
          </div>
        </div>
      )}
    </aside>
  )
}
