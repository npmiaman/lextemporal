'use client'

import { useState, type ReactNode } from 'react'
import {
  ArrowLeft, Bot, CreditCard, Monitor, Search, Settings,
} from 'lucide-react'
import { Button } from '@/components/ui/button'

export type Appearance = 'light' | 'dark' | 'system'

const sections = [
  ['General', Settings], ['Appearance', Monitor],
  ['Plan & Usage', CreditCard], ['Papers', Bot],
] as const

type Preferences = {
  tips: boolean; notifications: boolean; warnings: boolean; menuBar: boolean; sounds: boolean
  dataSharing: boolean; toolDensity: number; wordWrap: boolean; themedDiffs: boolean
  hue: number; intensity: number; reduceTransparency: boolean; uiFontSize: number
  codeFontSize: number; uiFont: string; codeFont: string; fontSmoothing: boolean
  highContrast: boolean; reduceMotion: string; confetti: boolean; hideEmail: boolean
  submitWithCommand: boolean; defaultEnvironment: string; defaultModel: string
  queueMode: string; usageSummary: string; autocomplete: boolean; autoTransitions: boolean
  importConfigs: boolean; importClaude: boolean; webSearch: boolean; autoWebSearch: boolean
  webFetch: boolean; waitForMcp: boolean; runMode: string; fileDeletionProtection: boolean
  externalFileProtection: boolean; legacyTerminal: boolean; autoParseLinks: boolean
}

const defaults: Preferences = {
  tips: true, notifications: true, warnings: false, menuBar: true, sounds: false,
  dataSharing: false, toolDensity: 0, wordWrap: true, themedDiffs: true, hue: 50,
  intensity: 0, reduceTransparency: false, uiFontSize: 13, codeFontSize: 12,
  uiFont: 'System font', codeFont: 'System monospace', fontSmoothing: true,
  highContrast: true, reduceMotion: 'System', confetti: false, hideEmail: false,
  submitWithCommand: false, defaultEnvironment: 'Last used', defaultModel: 'Nemotron 3 Ultra 550B',
  queueMode: 'Send after current message', usageSummary: 'Auto', autocomplete: true,
  autoTransitions: false, importConfigs: true, importClaude: false, webSearch: true,
  autoWebSearch: true, webFetch: true, waitForMcp: true, runMode: 'Auto-review (with sandbox)',
  fileDeletionProtection: true, externalFileProtection: true, legacyTerminal: false,
  autoParseLinks: true,
}

function loadPreferences() {
  if (typeof window === 'undefined') return defaults
  try { return { ...defaults, ...JSON.parse(localStorage.getItem('pigeon-settings') || '{}') } as Preferences } catch { return defaults }
}

function Toggle({ value, onChange }: { value: boolean; onChange: (value: boolean) => void }) {
  return <button type="button" role="switch" aria-checked={value} onClick={() => onChange(!value)} className={`relative h-5 w-9 shrink-0 rounded-full p-0 transition-colors ${value ? 'bg-emerald-600 dark:bg-emerald-500' : 'bg-foreground/25'}`}><span className={`pointer-events-none absolute left-0.5 top-0.5 size-4 rounded-full bg-white shadow-sm transition-transform ${value ? 'translate-x-4' : 'translate-x-0'}`} /></button>
}

export function SettingsView({ appearance, onAppearanceChange, onClose }: { appearance: Appearance; onAppearanceChange: (value: Appearance) => void; onClose: () => void }) {
  const [section, setSection] = useState('General')
  const [query, setQuery] = useState('')
  const [prefs, setPrefs] = useState<Preferences>(loadPreferences)
  const update = <K extends keyof Preferences>(key: K, value: Preferences[K]) => {
    setPrefs(previous => {
      const next = { ...previous, [key]: value }
      localStorage.setItem('pigeon-settings', JSON.stringify(next))
      return next
    })
  }
  const visibleSections = sections.filter(([name]) => name.toLowerCase().includes(query.toLowerCase()))

  return (
    <div className="fixed inset-0 z-[100] flex bg-background text-foreground">
      <aside className="flex w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar p-3 text-sidebar-foreground">
        <Button variant="ghost" size="sm" className="mb-4 justify-start gap-2 text-xs" onClick={onClose}><ArrowLeft className="size-3.5" />Back</Button>
        <div className="mb-4 flex items-center gap-2 rounded-lg border bg-background px-2.5 py-1.5"><Search className="size-3.5 text-muted-foreground" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search Settings" className="min-w-0 flex-1 bg-transparent text-xs outline-none" /></div>
        <nav className="space-y-0.5 overflow-y-auto">
          {visibleSections.map(([name, Icon]) => <button key={name} type="button" onClick={() => setSection(name)} className={`flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-xs ${section === name ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium' : 'text-muted-foreground hover:bg-sidebar-accent/60'}`}><Icon className="size-3.5" />{name}</button>)}
        </nav>
        <div className="mt-auto flex items-center gap-2 border-t border-sidebar-border pt-3"><div className="flex size-7 items-center justify-center rounded-full bg-sidebar-accent text-sidebar-accent-foreground text-xs">A</div><div><p className="text-xs font-medium">Aman Pandit</p><p className="text-[11px] text-muted-foreground">Free Plan</p></div></div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto px-10 py-8">
        <div className="mx-auto max-w-4xl [&_button]:text-xs">
          <h1 className="mb-6 text-xl font-semibold">{section}</h1>
          {section === 'General' && <General prefs={prefs} update={update} />}
          {section === 'Appearance' && <AppearanceSettings appearance={appearance} onAppearanceChange={onAppearanceChange} prefs={prefs} update={update} />}
          {section === 'Plan & Usage' && <PlanUsage />}
          {section === 'Papers' && <AgentSettings prefs={prefs} update={update} />}
        </div>
      </main>
    </div>
  )
}

type SettingsProps = { prefs: Preferences; update: <K extends keyof Preferences>(key: K, value: Preferences[K]) => void }

function General({ prefs, update }: SettingsProps) {
  return <div className="space-y-7">
    <Group label="Account"><Row title="Pigeon Account" description="Manage your account and billing"><Button variant="outline" size="sm">Open</Button></Row><Row title="Upgrade to Pro" description="Access premium models, higher limits, and cloud agents"><Button size="sm">Upgrade</Button></Row></Group>
    <Group label="Startup"><SwitchRow title="Tips" description="Show rotating tips on the empty screen" value={prefs.tips} onChange={value => update('tips', value)} /><Row title="Window restoration" description="Control which chats Pigeon restores on startup"><Select value="Default" options={['Default', 'Always', 'Never']} /></Row></Group>
    <Group label="Notifications"><SwitchRow title="System notifications" description="Notify when an agent completes or needs attention" value={prefs.notifications} onChange={value => update('notifications', value)} /><SwitchRow title="Warning notifications" description="Show warning-level in-app messages" value={prefs.warnings} onChange={value => update('warnings', value)} /><SwitchRow title="Menu bar icon" description="Show Pigeon in the menu bar" value={prefs.menuBar} onChange={value => update('menuBar', value)} /><SwitchRow title="Completion sound" description="Play a sound when agents finish" value={prefs.sounds} onChange={value => update('sounds', value)} /></Group>
    <Group label="Privacy"><SwitchRow title="Share anonymous diagnostics" description="Help improve Pigeon with performance and reliability data" value={prefs.dataSharing} onChange={value => update('dataSharing', value)} /></Group>
    <Button variant="outline">Log out</Button>
  </div>
}

function AppearanceSettings({ appearance, onAppearanceChange, prefs, update }: SettingsProps & { appearance: Appearance; onAppearanceChange: (value: Appearance) => void }) {
  return <div className="space-y-7">
    <Group><Row title="Theme" description="Choose between light, dark, or system themes"><Select value={appearance} options={['system', 'light', 'dark']} onChange={value => onAppearanceChange(value as Appearance)} /></Row></Group>
    <Group label="Agent conversations"><Row title="Tool call density" description="Adjust how much detail is shown for tool calls"><input aria-label="Tool call density" className="w-48 accent-foreground" type="range" min="0" max="2" value={prefs.toolDensity} onChange={event => update('toolDensity', Number(event.target.value))} /></Row><SwitchRow title="Code block word wrap" description="Wrap long lines in agent conversation code blocks" value={prefs.wordWrap} onChange={value => update('wordWrap', value)} /><SwitchRow title="Themed diff backgrounds" description="Use themed background colors for inline code diffs" value={prefs.themedDiffs} onChange={value => update('themedDiffs', value)} /></Group>
    <Group label="Colors"><RangeRow title="Hue" description="Choose a tint color" value={prefs.hue} onChange={value => update('hue', value)} /><RangeRow title="Intensity" description="Control how strongly the tint is applied" value={prefs.intensity} onChange={value => update('intensity', value)} /><SwitchRow title="Reduce transparency" description="Replace translucent surfaces with opaque backgrounds" value={prefs.reduceTransparency} onChange={value => update('reduceTransparency', value)} /></Group>
    <Group label="Typography"><Row title="UI font size" description="Font size for the Pigeon interface"><Stepper value={prefs.uiFontSize} onChange={value => update('uiFontSize', value)} /></Row><Row title="Code font size" description="Font size for code editors and diffs"><Stepper value={prefs.codeFontSize} onChange={value => update('codeFontSize', value)} /></Row><Row title="UI font family" description="Override the Pigeon interface typeface"><Select value={prefs.uiFont} options={['System font', 'Inter', 'Geist']} onChange={value => update('uiFont', value)} /></Row><Row title="Code font family" description="Override the font for code editors and diffs"><Select value={prefs.codeFont} options={['System monospace', 'Geist Mono', 'JetBrains Mono']} onChange={value => update('codeFont', value)} /></Row><div className="mx-5 mb-3 overflow-hidden rounded-md font-mono text-xs"><div className="bg-rose-100 px-4 py-1 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300">− return a + b;</div><div className="bg-emerald-100 px-4 py-1 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">+ const result = a + b;<br />+ return result;</div></div><SwitchRow title="Font smoothing" description="Use native font anti-aliasing" value={prefs.fontSmoothing} onChange={value => update('fontSmoothing', value)} /></Group>
    <Group label="Accessibility"><SwitchRow title="Follow system high contrast" description="Use a high contrast theme when your OS requests it" value={prefs.highContrast} onChange={value => update('highContrast', value)} /><Row title="Reduce motion" description="Minimize interface animations"><Select value={prefs.reduceMotion} options={['System', 'On', 'Off']} onChange={value => update('reduceMotion', value)} /></Row></Group>
    <Group label="Privacy"><SwitchRow title="Hide email address" description="Partially mask your email address in Pigeon" value={prefs.hideEmail} onChange={value => update('hideEmail', value)} /></Group>
  </div>
}

function PlanUsage() {
  return <div className="grid gap-5 text-xs md:grid-cols-2"><section className="rounded-2xl bg-muted/60 p-5"><div className="mb-3 flex justify-between font-medium"><span>Included usage</span><span>60%</span></div><div className="h-2 overflow-hidden rounded-full bg-input"><div className="h-full w-3/5 rounded-full bg-blue-500 dark:bg-blue-400" /></div><p className="mt-3 text-xs text-muted-foreground">Resets 21 Aug 2026</p></section><section className="rounded-2xl bg-muted/60 p-5"><p className="font-medium">Pro <span className="text-xs text-muted-foreground">$20/mo</span></p><p className="my-3 text-xs text-muted-foreground">Premium models, larger usage allowance, and more concurrent agents.</p><Button variant="outline" size="sm">Upgrade to Pro</Button></section></div>
}

function AgentSettings({ prefs, update }: SettingsProps) {
  return <div className="space-y-7">
    <Group label="Conversation"><SwitchRow title="Submit with ⌘ + Enter" description="Use Enter for a newline and ⌘Enter to submit" value={prefs.submitWithCommand} onChange={value => update('submitWithCommand', value)} /><Row title="Default environment" description="Where new agents start by default"><Select value={prefs.defaultEnvironment} options={['Last used', 'Local workspace', 'Cloud']} onChange={value => update('defaultEnvironment', value)} /></Row><Row title="Default model" description="What model new agents use by default"><Select value={prefs.defaultModel} options={['Nemotron 3 Ultra 550B', 'Mimo v2.5', 'Llama 3.3 70B']} onChange={value => update('defaultModel', value)} /></Row><Row title="Queue messages" description="What happens when a message is sent while an agent is running"><Select value={prefs.queueMode} options={['Send after current message', 'Steer current run', 'Ask every time']} onChange={value => update('queueMode', value)} /></Row><Row title="Usage summary" description="When to show usage details in chat"><Select value={prefs.usageSummary} options={['Auto', 'Always', 'Never']} onChange={value => update('usageSummary', value)} /></Row><SwitchRow title="Agent autocomplete" description="Show contextual suggestions while prompting" value={prefs.autocomplete} onChange={value => update('autocomplete', value)} /><SwitchRow title="Auto-approve mode transitions" description="Let agents switch workflow modes without asking first" value={prefs.autoTransitions} onChange={value => update('autoTransitions', value)} /></Group>
    <Group label="Third-party imports"><SwitchRow title="Include third-party skills and configs" description="Import compatible agent configuration from other tools" value={prefs.importConfigs} onChange={value => update('importConfigs', value)} /><SwitchRow title="Import Claude Code conversations" description="Sync compatible chats and continue them in Pigeon" value={prefs.importClaude} onChange={value => update('importClaude', value)} /></Group>
    <Group label="Context and tools"><SwitchRow title="Web search tool" description="Allow agents to search the web for relevant information" value={prefs.webSearch} onChange={value => update('webSearch', value)} /><SwitchRow title="Auto-accept web search" description="Run web searches automatically when required" value={prefs.autoWebSearch} onChange={value => update('autoWebSearch', value)} /><SwitchRow title="Web fetch tool" description="Allow agents to fetch content from URLs" value={prefs.webFetch} onChange={value => update('webFetch', value)} /><SwitchRow title="Wait for MCP authentication" description="Pause for authentication instead of skipping the integration" value={prefs.waitForMcp} onChange={value => update('waitForMcp', value)} /></Group>
    <Group label="Execution and approvals"><Row title="Run mode" description="Choose how agents run commands, integrations, and file writes"><Select value={prefs.runMode} options={['Auto-review (with sandbox)', 'Ask before changes', 'Full local access']} onChange={value => update('runMode', value)} /></Row><SwitchRow title="File-deletion protection" description="Prevent agents from deleting files automatically" value={prefs.fileDeletionProtection} onChange={value => update('fileDeletionProtection', value)} /><SwitchRow title="External-file protection" description="Protect files outside the active workspace" value={prefs.externalFileProtection} onChange={value => update('externalFileProtection', value)} /></Group>
    <Group label="Terminal and editing"><SwitchRow title="Legacy terminal tool" description="Use the legacy runner for unsupported shell configurations" value={prefs.legacyTerminal} onChange={value => update('legacyTerminal', value)} /><SwitchRow title="Auto-parse links" description="Automatically detect links pasted into prompts" value={prefs.autoParseLinks} onChange={value => update('autoParseLinks', value)} /></Group>
  </div>
}

function Group({ label, children }: { label?: string; children: ReactNode }) { return <section>{label && <p className="mb-2 text-xs text-muted-foreground">{label}</p>}<div className="divide-y rounded-2xl bg-muted/60">{children}</div></section> }
function Row({ title, description, children }: { title: string; description: string; children: ReactNode }) { return <div className="flex min-h-16 items-center gap-5 px-5 py-3"><div className="min-w-0 flex-1"><p className="text-xs font-medium">{title}</p><p className="text-xs text-muted-foreground">{description}</p></div>{children}</div> }
function SwitchRow({ title, description, value, onChange }: { title: string; description: string; value: boolean; onChange: (value: boolean) => void }) { return <Row title={title} description={description}><Toggle value={value} onChange={onChange} /></Row> }
function Select({ value, options, onChange }: { value: string; options: string[]; onChange?: (value: string) => void }) { return <select value={value} onChange={event => onChange?.(event.target.value)} className="max-w-64 rounded-lg border bg-background px-2 py-1 text-xs outline-none">{options.map(option => <option key={option}>{option}</option>)}</select> }
function Stepper({ value, onChange }: { value: number; onChange: (value: number) => void }) { return <div className="flex items-center overflow-hidden rounded-lg border bg-background text-xs"><button className="px-2.5 py-1" onClick={() => onChange(Math.max(10, value - 1))}>−</button><span className="w-8 text-center">{value}</span><button className="px-2.5 py-1" onClick={() => onChange(Math.min(24, value + 1))}>+</button></div> }
function RangeRow({ title, description, value, onChange }: { title: string; description: string; value: number; onChange: (value: number) => void }) { return <Row title={title} description={description}><input aria-label={title} className="w-48 accent-foreground" type="range" min="0" max="100" value={value} onChange={event => onChange(Number(event.target.value))} /></Row> }
