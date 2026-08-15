# LexTemporal — temporal-validity legal research

AI-driven legal research for Indian commercial litigation. Every authority retrieved from
Indian Kanoon is validated against **your matter's timeline** by a deterministic statute
graph — so a pre-2018 specific-performance judgment gets flagged **red** before you cite it.

## Stack

- Next.js (App Router) + TypeScript + Tailwind + shadcn/ui
- SQLite (`data/lex.db`, via better-sqlite3) — permanent API cache, audit log, matters, drafts
- Retrieval: [Indian Kanoon API](https://api.indiankanoon.org) (cache-first; "Powered by IKanoon")
- LLM: Google Gemini (`@google/genai`, JSON mode, temperature 0, prompt-hash cached)
- Validity engine: pure regex + hand-verified `data/mappings.json` — no LLM, no network

## Setup

```bash
cp .env.example .env.local   # fill in your tokens
npm install
npm run dev                  # http://localhost:3000
```

| Env var | Purpose |
| --- | --- |
| `INDIANKANOON_API_TOKEN` | Indian Kanoon API token (prepaid — keep balance topped up) |
| `GEMINI_API_KEY` | Google Gemini API key |
| `GEMINI_MODEL` | `gemini-2.5-flash` (default) or `gemini-2.5-pro` |

## Workflow

1. **Matter** — create a matter (breach/suit dates govern all validity checks). A sample
   matter is available for a first run.
2. **Research** — search Indian Kanoon (court + date filters). Each result carries a
   green/amber/red/grey temporal-validity flag with a full explainability payload
   (provisions detected, mappings consulted, dates checked). **Pin** the authorities you
   want to draft from.
3. **Arguments** — draft both sides from your pinned authorities only. Every sentence
   carries a `[dN¶M]` citation resolving to the actual judgment paragraph; unsupported
   points appear as abstentions. Override any statute mapping — dependent arguments go
   stale until re-verified (a real re-draft against your correction).
4. **Simulation** — adversarial runs (opposing angle × judge strictness), one real LLM
   call each, tallied with the recurring weak point linked back to Research.
5. **Export** — sign-off gate; everything lands in the append-only audit log.

## Notes

- Every IK search/doc and LLM response is cached in SQLite forever — repeat queries are
  free and work offline.
- `data/mappings.json` is the legal spine (SRA 2018, CCA 2018, A&C 2015/2019/2021,
  Evidence Act → BSA 2023). Extend it as coverage grows; it is zod-validated on boot and
  covered by `npm test`.
- API spend counter shows in the Research footer (₹0.50/search + ₹0.20/doc).

## Scripts

- `npm test` — vitest: validity engine (boundary dates, grey paths) + override cascade
- `npx tsx --env-file=.env.local scripts/ik-smoke.ts` — Indian Kanoon connectivity check
- `npx tsx --env-file=.env.local scripts/llm-smoke.ts` — Gemini connectivity check
