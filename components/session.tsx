'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2, Upload } from 'lucide-react'
import { Composer } from '@/components/composer'
import { AgentActivity, type ActivityStep } from '@/components/agent-activity'
import { parseMentions, type AgentStep, type Artifact, type Message, type UploadedDoc } from '@/lib/workspace'
import { AuthorityList } from '@/components/authority-list'
import { Skeleton } from '@/components/ui/skeleton'
import type { ArtifactTab } from '@/components/artifact-panel'
import type { Hearing } from '@/lib/courtroom'

const uid = () => Math.random().toString(36).slice(2, 10)

/** An authority as the flagging pass returned it, carried across turns. */
export interface Authority {
  cnr: string
  title: string
  date: string
  citation: string
  color: string
  reason: string
}

/** One NDJSON line from /api/agent. */
type AgentEvent =
  | { t: 'step'; step: AgentStep }
  | { t: 'reply'; text: string }
  | { t: 'authorities'; authorities: Authority[] }
  | { t: 'timeline'; timeline: { agreement?: string; cause?: string; suit?: string } }
  | { t: 'artifact'; artifact: ArtifactTab }
  | { t: 'hearing'; hearing: Hearing }
  | { t: 'done' }

/** The half of a chat's state this component owns. */
export interface SessionState {
  messages: Message[]
  docs: UploadedDoc[]
  authorities: Authority[]
}

/**
 * The research session: case papers in, conversation out.
 *
 * This replaces the coding dashboard's build-job session. The chrome is the
 * same — same composer, same agent-activity glyph, same bubble treatment — but
 * every backend call goes to LexTemporal: /api/documents to read the papers,
 * /api/agent to run retrieval, flagging and reasoning.
 */
export function Session({
  initial,
  artifacts,
  onArtifact,
  onHearing,
  onState,
  onTimeline,
}: {
  initial?: SessionState
  artifacts: Artifact[]
  onArtifact?: (tab: ArtifactTab) => void
  onHearing?: (h: Hearing) => void
  /** Reported after every change so the shell can persist the chat. */
  onState?: (s: SessionState) => void
  onTimeline?: (t: { agreement?: string; cause?: string; suit?: string }) => void
}) {
  const [docs, setDocs] = useState<UploadedDoc[]>(initial?.docs ?? [])
  const [messages, setMessages] = useState<Message[]>(initial?.messages ?? [])
  const [busy, setBusy] = useState(false)
  // Carried across turns so a follow-up like "draft the arguments" works off the
  // authorities already retrieved rather than searching the corpus for its own
  // wording — which is what made every follow-up return the same six unrelated
  // judgments.
  const [authorities, setAuthorities] = useState<Authority[]>(initial?.authorities ?? [])
  // Simulation needs authorities to argue about, so it stays disabled until a
  // research run has actually returned some.
  const [researched, setResearched] = useState((initial?.authorities?.length ?? 0) > 0)
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
  const abort = useRef<AbortController | null>(null)
  const scroller = useRef<HTMLDivElement>(null)

  const started = messages.length > 0

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })
  }, [messages, busy])

  // Held in a ref so re-reporting cannot re-fire on a new closure identity — the
  // shell re-renders on every report, and depending on the callback itself would
  // make that a loop.
  const report = useRef(onState)
  report.current = onState
  useEffect(() => {
    report.current?.({ messages, docs, authorities })
  }, [messages, docs, authorities])

  // A file dropped anywhere outside the pane would otherwise be opened by the
  // browser, navigating away from the session and losing the transcript.
  useEffect(() => {
    const swallow = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault()
    }
    window.addEventListener('dragover', swallow)
    window.addEventListener('drop', swallow)
    return () => {
      window.removeEventListener('dragover', swallow)
      window.removeEventListener('drop', swallow)
    }
  }, [])

  const addFiles = async (files: File[]) => {
    const staged: UploadedDoc[] = files.map((f) => ({
      id: uid(),
      name: f.name,
      sizeBytes: f.size,
      kind: f.name.toLowerCase().endsWith('.pdf') ? 'pdf' : 'text',
      status: 'uploading',
    }))
    setDocs((d) => [...d, ...staged])
    // Uploaded together, not one after another. Serially, dropping four scanned
    // pages meant waiting for the sum of four OCR passes while three of them sat
    // idle; each also lands in the list as soon as its own read finishes.
    await Promise.all(
      files.map(async (file, i) => {
        const body = new FormData()
        body.append('file', file)
        try {
          const res = await fetch('/api/documents', { method: 'POST', body })
          const json = (await res.json()) as { excerpt?: string; error?: string }
          setDocs((d) =>
            d.map((x) =>
              x.id === staged[i].id
                ? res.ok
                  ? { ...x, status: 'parsed', excerpt: json.excerpt }
                  : { ...x, status: 'failed', error: json.error }
                : x,
            ),
          )
        } catch (e) {
          setDocs((d) => d.map((x) => (x.id === staged[i].id ? { ...x, status: 'failed', error: String(e) } : x)))
        }
      }),
    )
  }

  const send = async (text: string) => {
    const mentions = parseMentions(text, artifacts)
    const agentId = uid()
    // Snapshot the transcript before this turn: the request needs the prior
    // turns, and setState is async so reading `messages` after the update would
    // still give the old array anyway.
    const priorTurns = messages.map((m) => ({ role: m.role, text: m.text }))
    setMessages((m) => [
      ...m,
      { id: uid(), role: 'user', text, mentions, createdAt: new Date().toISOString() },
      { id: agentId, role: 'agent', text: '', steps: [], createdAt: new Date().toISOString() },
    ])
    setBusy(true)

    // Steps stream in twice — running, then done — and are merged by id, so the
    // checklist ticks over live instead of appearing complete all at once.
    const mergeStep = (step: AgentStep) =>
      setMessages((m) =>
        m.map((x) => {
          if (x.id !== agentId) return x
          const steps = x.steps ?? []
          const at = steps.findIndex((s) => s.id === step.id)
          return { ...x, steps: at === -1 ? [...steps, step] : steps.map((s, i) => (i === at ? step : s)) }
        }),
      )

    const controller = new AbortController()
    abort.current = controller

    try {
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          prompt: text,
          mentions,
          docs: docs.filter((d) => d.status === 'parsed').map((d) => ({ name: d.name, excerpt: d.excerpt })),
          history: priorTurns.filter((t) => t.text),
          authorities,
        }),
      })
      if (!res.body) throw new Error('no response body')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        // The last fragment is usually a partial line; leave it in the buffer.
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) continue
          let event: AgentEvent
          try {
            event = JSON.parse(line) as AgentEvent
          } catch {
            continue
          }
          if (event.t === 'step') mergeStep(event.step)
          else if (event.t === 'reply')
            setMessages((m) => m.map((x) => (x.id === agentId ? { ...x, text: event.text } : x)))
          else if (event.t === 'authorities') {
            setAuthorities(event.authorities)
            if (event.authorities.length > 0) setResearched(true)
          } else if (event.t === 'timeline') onTimeline?.(event.timeline)
          else if (event.t === 'artifact') onArtifact?.(event.artifact)
          else if (event.t === 'hearing') onHearing?.(event.hearing)
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        setMessages((m) => m.map((x) => (x.id === agentId ? { ...x, text: `That failed: ${String(e)}` } : x)))
      }
    } finally {
      abort.current = null
      setBusy(false)
    }
  }

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        dragDepth.current += 1
        setDragging(true)
      }}
      onDragOver={(e) => {
        // Without preventDefault the browser refuses the drop and, on release,
        // navigates to the file instead.
        if (e.dataTransfer.types.includes('Files')) e.preventDefault()
      }}
      onDragLeave={() => {
        // dragleave fires for every child crossed, so count depth rather than
        // clearing on the first one.
        dragDepth.current = Math.max(0, dragDepth.current - 1)
        if (dragDepth.current === 0) setDragging(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        dragDepth.current = 0
        setDragging(false)
        if (e.dataTransfer.files.length) void addFiles(Array.from(e.dataTransfer.files))
      }}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-3 z-40 flex items-center justify-center rounded-2xl border-2 border-dashed border-brand bg-background/85 backdrop-blur-sm">
          <div className="text-center">
            <Upload className="mx-auto mb-2 size-6 text-brand" />
            <p className="text-sm font-medium text-foreground">Drop to attach</p>
            <p className="mt-1 text-xs text-muted-foreground">PDF · TXT · MD · images (OCR)</p>
          </div>
        </div>
      )}
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-6">
        <div className="mx-auto w-full max-w-3xl pt-8 pb-6">
          {!started ? (
            <div className="h-px" />
          ) : (
            <div className="space-y-6">
              {messages.map((m) =>
                m.role === 'user' ? (
                  <div key={m.id} className="flex justify-end">
                    <div className="max-w-[85%] rounded-2xl bg-bubble px-4 py-2.5 text-[14px] leading-relaxed text-bubble-foreground">
                      {m.text}
                      {m.mentions && m.mentions.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {m.mentions.map((id) => (
                            <span key={id} className="rounded-full bg-foreground/10 px-2 py-0.5 font-mono text-[10px]">
                              @{id}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div key={m.id} className="max-w-[92%]">
                    {m.steps && m.steps.length > 0 && (
                      <div className="mb-4">
                        <AgentActivity
                          steps={m.steps.map(toActivityStep)}
                          // Only the turn still in flight is "thinking". Leaving
                          // every finished turn under that header made a
                          // completed transcript read as permanently mid-run.
                          running={busy && m.id === messages.at(-1)?.id}
                        />
                      </div>
                    )}
                    {m.text ? (
                      <p className="text-[15px] leading-[1.7] whitespace-pre-wrap text-foreground">{m.text}</p>
                    ) : (
                      // The answer has weight on the page before it has words, so
                      // the transcript does not jump when it arrives.
                      busy &&
                      m.id === messages.at(-1)?.id && (
                        <div className="space-y-2.5">
                          <Skeleton className="h-3.5 w-[92%]" />
                          <Skeleton className="h-3.5 w-[78%]" />
                          <Skeleton className="h-3.5 w-[85%]" />
                        </div>
                      )
                    )}
                    {m.authorities && m.authorities.length > 0 && (
                      <AuthorityList authorities={m.authorities} />
                    )}
                  </div>
                ),
              )}
              {busy && !messages.at(-1)?.steps?.length && (
                <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" />
                  Working…
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="mx-auto w-full max-w-3xl px-6 pb-5">
        <Composer
          docked
          busy={busy}
          onSend={(t) => void send(t)}
          onStop={() => abort.current?.abort()}
          onFiles={(files) => void addFiles(files)}
          canSimulate={researched}
          onSimulate={() => void send('Simulate the hearing on the authorities retrieved.')}
          attachments={docs.map((d) => ({ id: d.id, name: d.name, status: d.status }))}
          onRemoveAttachment={(id) => setDocs((x) => x.filter((y) => y.id !== id))}
        />
      </div>
    </div>
  )
}

/** LexTemporal's AgentStep renders through Pigeon's ActivityStep contract. */
function toActivityStep(s: NonNullable<Message['steps']>[number]): ActivityStep {
  return {
    id: s.id,
    title: s.title,
    summary: s.detail,
    // Pigeon's taskState() checks for 'completed' — 'done' silently falls
    // through to 'pending', which renders every finished step as an empty
    // circle and the header as "0/4 done".
    status: s.status === 'running' ? 'running' : s.status === 'failed' ? 'failed' : 'completed',
    outputs: s.findings?.map((f) => f.headline),
  }
}
