'use client'

import { useState } from 'react'
import { ArrowUp, Check, ChevronDown, Gavel, Image as ImageIcon, Loader2, Paperclip, Plus, Square, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Textarea } from '@/components/ui/textarea'

const projects = [
  'first-100-users',
  'cold-outreach',
  'user-interviews',
  'investor-updates',
  'yc-application',
]

// The actual NIM engines. Picking one makes it the PREFERRED model - it goes
// first for chat, intent, and builds; the others stay as failover.
// "Auto" pins nothing, which lets the agent route each pipeline STAGE to the
// engine that benches best for it (structured output vs tool calling) and
// spreads a build across separate free-tier queues. Chat and intent are a
// single interactive call with no stages to route, so Auto resolves to
// GPT-OSS there - see asEngine in lib/nim.
export type ModelId = 'auto' | 'nemotron' | 'gpt' | 'glm'
// GPT-OSS answers in seconds on the free tier; Nemotron routinely sits in
// queue past the chat route's first-token watchdog. The heavyweight stays one
// click away for when depth beats speed.
export const DEFAULT_MODEL: ModelId = 'auto'

export const MODELS: { id: ModelId; name: string; note?: string }[] = [
  { id: 'auto', name: 'Auto', note: 'best engine per stage' },
  { id: 'gpt', name: 'GPT-OSS 120B', note: 'fastest' },
  { id: 'nemotron', name: 'Nemotron 3 Ultra 550B' },
  { id: 'glm', name: 'GLM 5.2', note: 'unstable' },
]

// A quiet dropdown trigger that reads as plain text, like the reference UI.
function Picker({
  value,
  options,
  onChange,
}: {
  value: string
  options: string[]
  onChange: (v: string) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5 px-2 font-normal text-foreground/80">
          {value}
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {options.map((option) => (
          <DropdownMenuItem key={option} onSelect={() => onChange(option)}>
            {option}
            {option === value && <Check className="ml-auto size-4" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function Composer({
  onSend,
  onStop,
  onFiles,
  onSimulate,
  canSimulate = false,
  attachments = [],
  onRemoveAttachment,
  docked = false,
  busy = false,
  model = DEFAULT_MODEL,
  onModelChange,
}: {
  onSend?: (text: string) => void
  /** Case papers and images dropped, pasted or picked from the composer. */
  onFiles?: (files: File[]) => void
  /** Simulate the hearing. Disabled until research has produced authorities —
      there is nothing to argue about before then. */
  onSimulate?: () => void
  canSimulate?: boolean
  attachments?: { id: string; name: string; status: 'uploading' | 'parsed' | 'failed' }[]
  onRemoveAttachment?: (id: string) => void
  onStop?: () => void
  docked?: boolean
  busy?: boolean
  model?: ModelId
  onModelChange?: (m: ModelId) => void
}) {
  const [project, setProject] = useState(projects[0])
  const [prompt, setPrompt] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [actionsOpen, setActionsOpen] = useState(false)
  const hasPrompt = prompt.trim().length > 0
  const active = MODELS.find((m) => m.id === model) ?? MODELS[0]

  const submit = () => {
    const text = prompt.trim()
    if (!text) return
    setPrompt('')
    onSend?.(text)
  }

  return (
    <div
      className="relative w-full max-w-2xl"
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={(e) => {
        // Only clear when the pointer actually leaves the composer, not when it
        // crosses one of the child controls.
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        if (e.dataTransfer.files.length) onFiles?.(Array.from(e.dataTransfer.files))
      }}
    >
      {!docked && (
        <div className="flex items-center pl-1">
          <Picker value={project} options={projects} onChange={setProject} />
        </div>
      )}

      <div
        className={`mt-1.5 rounded-2xl border bg-card shadow-[0_2px_12px_rgba(0,0,0,0.05)] transition-colors dark:shadow-[0_2px_12px_rgba(0,0,0,0.4)] ${
          dragOver ? 'border-brand bg-brand/5' : ''
        }`}
      >
        {attachments.length > 0 && (
          <ul className="flex flex-wrap gap-1.5 px-3 pt-3">
            {attachments.map((a) => (
              <li
                key={a.id}
                className="inline-flex items-center gap-1.5 rounded-full border bg-muted/60 py-1 pr-1 pl-2.5"
              >
                {a.status === 'uploading' ? (
                  <Loader2 className="size-3 animate-spin text-muted-foreground" />
                ) : (
                  <Paperclip className={`size-3 ${a.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}`} />
                )}
                <span className="max-w-40 truncate text-[12px] text-foreground">{a.name}</span>
                <button
                  type="button"
                  aria-label={`Remove ${a.name}`}
                  onClick={() => onRemoveAttachment?.(a.id)}
                  className="grid size-5 place-items-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground"
                >
                  <X className="size-3" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <Textarea
          placeholder={
            busy ? 'Researching — your message will queue…' : 'Drop the case papers here, or ask what you need to establish…'
          }
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files)
            if (files.length) {
              e.preventDefault()
              onFiles?.(files)
            }
          }}
          className="min-h-16 resize-none border-0 bg-transparent px-4 pt-4 shadow-none focus-visible:ring-0 dark:bg-transparent"
        />
        <div className="flex items-center gap-2 p-2.5">
          <Button
            variant="outline"
            size="icon-sm"
            className={actionsOpen ? 'rounded-full bg-muted' : 'rounded-full'}
            aria-label="Add context"
            aria-expanded={actionsOpen}
            onClick={() => setActionsOpen((open) => !open)}
          >
            <Plus className="text-muted-foreground" />
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-1.5 px-2 font-normal">
                {active.name}
                <ChevronDown className="size-3.5 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {MODELS.map((m) => (
                <DropdownMenuItem key={m.id} onSelect={() => onModelChange?.(m.id)}>
                  {m.name}
                  {m.note && <span className="text-xs text-muted-foreground">{m.note}</span>}
                  {m.id === model && <Check className="ml-auto size-4" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {onSimulate && (
            <Button
              variant="outline"
              size="sm"
              disabled={!canSimulate || busy}
              onClick={onSimulate}
              title={
                canSimulate
                  ? 'Run the hearing against the authorities just retrieved'
                  : 'Run research first — there are no authorities to argue about yet'
              }
              className="ml-auto gap-1.5 rounded-full font-normal disabled:opacity-35"
            >
              <Gavel className="size-3.5" />
              Simulate
            </Button>
          )}

          {/* Send, always — there is no dictation path here, and a mic that does
              nothing is worse than an obviously-disabled send. While a run is in
              flight the same button stops it. */}
          <Button
            size="icon"
            disabled={!busy && !hasPrompt}
            className="rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-30"
            aria-label={busy ? 'Stop' : 'Send'}
            onClick={busy ? onStop : submit}
          >
            {busy ? <Square className="size-3 fill-current" /> : <ArrowUp />}
          </Button>
        </div>
      </div>

      {actionsOpen && (
        <div className={`z-30 w-full overflow-hidden rounded-2xl border bg-popover p-2 text-popover-foreground shadow-lg ${docked ? 'absolute bottom-[calc(100%+8px)]' : 'mt-2'}`}>
          <label className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-muted">
            <Paperclip className="size-4 text-muted-foreground" />
            <span>Files</span>
            <span className="ml-auto text-xs text-muted-foreground">PDF · TXT · MD</span>
            <input
              type="file"
              multiple
              accept=".pdf,.txt,.md,.markdown"
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) onFiles?.(Array.from(e.target.files))
                e.target.value = ''
                setActionsOpen(false)
              }}
            />
          </label>
          <label className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-muted">
            <ImageIcon className="size-4 text-muted-foreground" />
            <span>Images</span>
            <span className="ml-auto text-xs text-muted-foreground">scanned orders · OCR</span>
            <input
              type="file"
              multiple
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) onFiles?.(Array.from(e.target.files))
                e.target.value = ''
                setActionsOpen(false)
              }}
            />
          </label>
        </div>
      )}

      {!docked && (
        <div className="mt-3 flex items-center gap-2">
          <Button variant="outline" size="sm" className="rounded-full font-normal text-foreground/80">
            Plan New Idea
            <span className="text-muted-foreground">⇧Tab</span>
          </Button>
          <Button variant="outline" size="sm" className="rounded-full font-normal text-foreground/80">
            Multitask
          </Button>
        </div>
      )}
    </div>
  )
}
