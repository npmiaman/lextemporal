"use client";

// Client state only. Server state (matters, cache, audit, arguments, overrides)
// lives in SQLite behind the API routes; this store holds view state and
// fetched copies scoped to the active matter.

import { create } from "zustand";
import type { RankedJudgment } from "@/lib/retrieval";
import type { DraftedArgument, DraftSource } from "@/lib/drafting";
import type { StatuteMapping } from "@/lib/mappings";
import type { MappingOverride } from "@/lib/override";
import type { AuditRow } from "@/lib/audit";
import type { SimTally } from "@/lib/simulation";
import type { Matter, MatterInput, PinnedDoc } from "@/lib/matter";

export type View = "matter" | "research" | "arguments" | "simulation" | "audit-log";
export type Autonomy = "Ask every step" | "Supervised" | "Autonomous (gated)";

export interface Spend {
  searches: number;
  docs: number;
  rupees: number;
}

export interface DraftState {
  args: DraftedArgument[];
  abstentions: string[];
  sources: DraftSource[];
}

async function jsonFetch<T>(url: string, body?: unknown, method?: string): Promise<T> {
  const res = await fetch(url, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

interface LexState {
  activeView: View;
  setView: (v: View) => void;

  autonomy: Autonomy;
  setAutonomy: (a: Autonomy) => Promise<void>;

  matters: Matter[];
  activeMatterId: number | null;
  lawDataCurrentAsOf: string;
  ephemeral: boolean;
  spend: Spend | null;
  loadMatters: () => Promise<void>;
  setActiveMatter: (id: number) => void;
  createMatter: (input: MatterInput) => Promise<Matter>;
  createSampleMatter: () => Promise<Matter>;
  updateMatter: (id: number, input: MatterInput) => Promise<void>;

  pins: PinnedDoc[];
  loadPins: () => Promise<void>;
  togglePin: (j: RankedJudgment) => Promise<void>;

  // Research — kept in the store so results survive view switches.
  query: string;
  setQuery: (q: string) => void;
  filters: { doctypes: string; fromdate: string; todate: string };
  setFilters: (f: Partial<LexState["filters"]>) => void;
  searching: boolean;
  searchStatus: string;
  results: RankedJudgment[];
  networkDown: boolean;
  runSearch: (query?: string) => Promise<void>;

  pulseDocId: string | null;
  clearPulse: () => void;
  searchWeakPoint: (query: string) => Promise<void>;

  drafts: Record<"ours" | "opposing", DraftState | null>;
  loadingDrafts: boolean;
  peekDrafts: () => Promise<void>;
  draftNow: (force: boolean) => Promise<void>;

  mappings: StatuteMapping[];
  overrides: MappingOverride[];
  argumentStatus: {
    id: string;
    side: string;
    status: string;
    version: number;
    mapping_deps: string[];
  }[];
  loadMappings: () => Promise<void>;

  auditRows: AuditRow[];
  auditSeenMax: number;
  loadAudit: () => Promise<void>;

  simTally: SimTally | null;
  simRunning: boolean;
  simTarget: number;
  runSimulation: (n: number) => Promise<void>;
}

function clearMatterScopedState() {
  return {
    results: [] as RankedJudgment[],
    searchStatus: "",
    networkDown: false,
    pins: [] as PinnedDoc[],
    drafts: { ours: null, opposing: null } as Record<"ours" | "opposing", DraftState | null>,
    argumentStatus: [] as LexState["argumentStatus"],
    simTally: null as SimTally | null,
    pulseDocId: null as string | null,
  };
}

export const useLexStore = create<LexState>((set, get) => ({
  activeView: "matter",
  setView: (v) => set({ activeView: v }),

  autonomy: "Supervised",
  setAutonomy: async (a) => {
    if (get().autonomy === a) return;
    set({ autonomy: a });
    await jsonFetch("/api/autonomy", { level: a });
    void get().loadAudit();
  },

  matters: [],
  activeMatterId: null,
  lawDataCurrentAsOf: "",
  ephemeral: false,
  spend: null,
  loadMatters: async () => {
    const out = await jsonFetch<{
      matters: Matter[];
      lawDataCurrentAsOf: string;
      spend: Spend;
      ephemeral?: boolean;
    }>("/api/matters");
    set({
      matters: out.matters,
      lawDataCurrentAsOf: out.lawDataCurrentAsOf,
      spend: out.spend,
      ephemeral: Boolean(out.ephemeral),
    });
    const { activeMatterId } = get();
    if (activeMatterId === null && out.matters.length > 0) {
      get().setActiveMatter(out.matters[0].id);
    } else if (activeMatterId !== null && !out.matters.some((m) => m.id === activeMatterId)) {
      set({ activeMatterId: out.matters[0]?.id ?? null, ...clearMatterScopedState() });
    }
  },
  setActiveMatter: (id) => {
    if (get().activeMatterId === id) return;
    set({ activeMatterId: id, ...clearMatterScopedState() });
    void get().loadPins();
    void get().peekDrafts();
    void get().loadMappings();
  },
  createMatter: async (input) => {
    const out = await jsonFetch<{ matter: Matter }>("/api/matters", { matter: input });
    await get().loadMatters();
    get().setActiveMatter(out.matter.id);
    void get().loadAudit();
    return out.matter;
  },
  createSampleMatter: async () => {
    const out = await jsonFetch<{ matter: Matter }>("/api/matters", { sample: true });
    await get().loadMatters();
    get().setActiveMatter(out.matter.id);
    void get().loadAudit();
    return out.matter;
  },
  updateMatter: async (id, input) => {
    await jsonFetch("/api/matters", { id, matter: input }, "PUT");
    await get().loadMatters();
    // Dates may have changed — recompute flags for anything on screen.
    if (get().results.length > 0) void get().runSearch();
    void get().loadAudit();
  },

  pins: [],
  loadPins: async () => {
    const id = get().activeMatterId;
    if (!id) return;
    const out = await jsonFetch<{ pins: PinnedDoc[] }>(`/api/pins?matterId=${id}`);
    set({ pins: out.pins });
  },
  togglePin: async (j) => {
    const id = get().activeMatterId;
    if (!id) return;
    const pinned = !get().pins.some((p) => p.docid === j.docid);
    const out = await jsonFetch<{ pins: PinnedDoc[] }>("/api/pins", {
      matterId: id,
      pinned,
      doc: {
        docid: j.docid,
        title: j.title,
        court: j.court,
        date: j.date,
        url: j.url,
        flag_color: j.flag.color,
      },
    });
    set({ pins: out.pins });
    void get().loadAudit();
  },

  query: "",
  setQuery: (q) => set({ query: q }),
  filters: { doctypes: "judgments", fromdate: "", todate: "" },
  setFilters: (f) => set((s) => ({ filters: { ...s.filters, ...f } })),
  searching: false,
  searchStatus: "",
  results: [],
  networkDown: false,
  runSearch: async (query) => {
    const matterId = get().activeMatterId;
    if (!matterId) {
      set({ searchStatus: "Create or select a matter first — flags depend on its timeline." });
      return;
    }
    const q = query ?? get().query;
    if (!q.trim() || get().searching) return;
    set({ searching: true, searchStatus: "Querying Indian Kanoon…", query: q });
    try {
      const f = get().filters;
      const filters: Record<string, string> = { doctypes: f.doctypes };
      if (f.fromdate) filters.fromdate = f.fromdate;
      if (f.todate) filters.todate = f.todate;
      const out = await jsonFetch<{
        results: RankedJudgment[];
        fromCache: boolean;
        networkDown: boolean;
        spend: Spend;
      }>("/api/search", { matterId, query: q, filters });
      set({
        results: out.results,
        networkDown: out.networkDown,
        spend: out.spend,
        searchStatus: out.networkDown
          ? "Network unavailable — showing cached results"
          : out.fromCache
            ? "Served from cache · validity flags computed live"
            : "Live Indian Kanoon results · validity flags computed",
      });
      void get().loadAudit();
    } catch (e) {
      set({ results: [], networkDown: true, searchStatus: `Search failed: ${String(e)}` });
    } finally {
      set({ searching: false });
    }
  },

  pulseDocId: null,
  clearPulse: () => set({ pulseDocId: null }),
  searchWeakPoint: async (query) => {
    set({ activeView: "research" });
    await get().runSearch(query);
    const hit =
      get().results.find((r) => r.flag.color === "amber" || r.flag.color === "red") ??
      get().results[0];
    set({ pulseDocId: hit?.docid ?? null });
  },

  drafts: { ours: null, opposing: null },
  loadingDrafts: false,
  peekDrafts: async () => {
    const matterId = get().activeMatterId;
    if (!matterId) return;
    const [ours, opposing] = await Promise.all([
      jsonFetch<DraftState>("/api/draft", { matterId, side: "ours", peek: true }),
      jsonFetch<DraftState>("/api/draft", { matterId, side: "opposing", peek: true }),
    ]);
    set({ drafts: { ours, opposing } });
  },
  draftNow: async (force) => {
    const matterId = get().activeMatterId;
    if (!matterId || get().loadingDrafts) return;
    set({ loadingDrafts: true });
    try {
      const ours = await jsonFetch<DraftState>("/api/draft", { matterId, side: "ours", force });
      set((s) => ({ drafts: { ...s.drafts, ours } }));
      const opposing = await jsonFetch<DraftState>("/api/draft", {
        matterId,
        side: "opposing",
        force,
      });
      set((s) => ({ drafts: { ...s.drafts, opposing } }));
      void get().loadMappings();
      void get().loadAudit();
    } finally {
      set({ loadingDrafts: false });
    }
  },

  mappings: [],
  overrides: [],
  argumentStatus: [],
  loadMappings: async () => {
    const id = get().activeMatterId ?? 0;
    const out = await jsonFetch<{
      mappings: StatuteMapping[];
      overrides: MappingOverride[];
      argumentStatus: LexState["argumentStatus"];
    }>(`/api/mappings?matterId=${id}`);
    set({ mappings: out.mappings, overrides: out.overrides, argumentStatus: out.argumentStatus });
  },

  auditRows: [],
  auditSeenMax: 0,
  loadAudit: async () => {
    const prevMax = get().auditRows[0]?.id ?? 0;
    const out = await jsonFetch<{ rows: AuditRow[] }>("/api/audit");
    set({ auditRows: out.rows, auditSeenMax: prevMax });
  },

  simTally: null,
  simRunning: false,
  simTarget: 10,
  runSimulation: async (n) => {
    const matterId = get().activeMatterId;
    if (!matterId || get().simRunning) return;
    set({ simRunning: true, simTarget: n, simTally: null });
    // Fresh batch label per run; unchanged matter+args reuse the LLM cache.
    const batch = `b${Date.now()}`;
    try {
      let tally: SimTally | null = null;
      do {
        const out = await jsonFetch<{ tally: SimTally }>("/api/simulate", { matterId, batch, n });
        tally = out.tally;
        set({ simTally: tally });
      } while (tally.runs < n);
      void get().loadAudit();
    } finally {
      set({ simRunning: false });
    }
  },
}));

export { jsonFetch };
