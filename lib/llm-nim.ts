// Conversational LLM on NVIDIA NIM — the same key already used for embedding
// and reranking, so the whole stack runs on one credential.
//
// Nemotron models are reasoning models: left alone they emit their chain of
// thought into `content` ("Here's a thinking process: 1. Analyze…"). Two things
// suppress that, and this client uses both: `chat_template_kwargs.thinking =
// false`, and a scrub of any reasoning preamble that still leaks through.
//
// Replies are cached by hash in the existing llm_cache table, so a repeated
// question costs nothing and works with the network down.

import crypto from "crypto";
import { getDb, nowIso } from "@/lib/db";

const BASE = process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1";
const MODEL = process.env.NVIDIA_CHAT_MODEL || "nvidia/nemotron-3-nano-30b-a3b";

export class LlmError extends Error {}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

function key(model: string, messages: ChatMessage[], salt: string): string {
  return crypto
    .createHash("sha256")
    .update(`${model}::${JSON.stringify(messages)}::${salt}`)
    .digest("hex");
}

function readCache(hash: string): string | null {
  try {
    const row = getDb()
      .prepare("SELECT response FROM llm_cache WHERE hash = ?")
      .get(hash) as { response: string } | undefined;
    return row?.response ?? null;
  } catch {
    return null;
  }
}

function writeCache(hash: string, model: string, prompt: string, response: string): void {
  try {
    getDb()
      .prepare(
        "INSERT OR REPLACE INTO llm_cache (hash, model, prompt, response, created_at) VALUES (?,?,?,?,?)"
      )
      .run(hash, model, prompt, response, nowIso());
  } catch {
    /* a cache write must never fail the reply */
  }
}

/** Strip reasoning that escaped `thinking: false`. */
export function scrubThinking(text: string): string {
  let out = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  // "Here's a thinking process: … " followed by the real answer after a blank line.
  out = out.replace(/^\s*(here'?s? (my|a) (thinking|thought) process|let me think)[\s\S]*?\n\n/i, "");
  // Numbered planning preambles the model sometimes emits before answering.
  out = out.replace(/^\s*(okay|alright)[,.]?\s+(the user|so)[^\n]*\n+/i, "");
  return out.trim();
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  /** Vary the cache key when the same messages should produce a fresh call. */
  cacheSalt?: string;
  signal?: AbortSignal;
}

export async function chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
  const apiKey = process.env.NVIDIA_CHAT_API_KEY || process.env.NVIDIA_EMBED_API_KEY || "";
  if (!apiKey) throw new LlmError("No NVIDIA API key set — cannot generate a reply.");

  const hash = key(MODEL, messages, opts.cacheSalt ?? "");
  const cached = readCache(hash);
  if (cached) return cached;

  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    signal: opts.signal ?? AbortSignal.timeout(45_000),
    body: JSON.stringify({
      model: MODEL,
      messages,
      temperature: opts.temperature ?? 0.3,
      max_tokens: opts.maxTokens ?? 700,
      // Suppresses the chain-of-thought preamble at the template level.
      chat_template_kwargs: { thinking: false },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new LlmError(`NIM chat failed (HTTP ${res.status}): ${body.slice(0, 180)}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string | null } }[];
  };
  const raw = data.choices?.[0]?.message?.content ?? "";
  const text = scrubThinking(raw);
  if (!text) throw new LlmError("NIM chat returned an empty reply.");

  writeCache(hash, MODEL, JSON.stringify(messages).slice(0, 4000), text);
  return text;
}

/**
 * Pull a JSON object out of a reply.
 *
 * NIM has no server-side schema enforcement, so the model will occasionally wrap
 * its object in prose or a ```json fence. Slicing between the first `{` and the
 * last `}` recovers those without accepting anything looser — if the slice does
 * not parse, that is a real failure and the caller must handle it rather than
 * receive a half-read object.
 */
export function parseJsonObject<T>(reply: string): T {
  const fenced = reply.replace(/```(?:json)?/gi, "");
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start === -1 || end <= start) throw new LlmError("Model did not return JSON.");
  try {
    return JSON.parse(fenced.slice(start, end + 1)) as T;
  } catch (e) {
    throw new LlmError(`Model returned malformed JSON: ${String(e).slice(0, 120)}`);
  }
}

/**
 * Recover the individual JSON objects from a reply whose outer structure is
 * broken — almost always because the response hit the token ceiling mid-array.
 *
 * Scans for balanced `{…}` runs (string-aware, so a brace inside a quoted value
 * does not throw off the depth count) and keeps each one that parses on its own.
 * The point is that a truncated transcript should lose its last turn, not all of
 * them; anything that does not parse is still dropped rather than guessed at.
 */
export function salvageObjects(reply: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  // A stack, not a depth counter: when the response is cut off the OUTER object
  // never closes, so the only objects that ever balance are the nested ones —
  // which are exactly the turns worth keeping.
  const stack: number[] = [];
  let inStr = false;
  let esc = false;
  for (let i = 0; i < reply.length; i++) {
    const c = reply[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") stack.push(i);
    else if (c === "}") {
      const start = stack.pop();
      if (start === undefined) continue;
      try {
        out.push(JSON.parse(reply.slice(start, i + 1)) as Record<string, unknown>);
      } catch {
        /* an object that does not parse is dropped, never repaired by guess */
      }
    }
  }
  return out;
}

/**
 * What the assistant is and what it must not claim. Kept here rather than in
 * each call site so every generated sentence inherits the same constraints —
 * in particular that it must never state a validity conclusion of its own,
 * because those come from deterministic date arithmetic, not from this model.
 */
export const SYSTEM_PROMPT = `You are LexTemporal, a research assistant for Indian commercial litigation.

What you do: retrieve judgments from a local corpus of Indian Supreme Court and High Court decisions, and check each one against the user's matter timeline to see whether the statutory provision it relied on has since been amended.

Hard rules:
- NEVER state that a judgment is good law, superseded, or safe to cite. Those conclusions are computed by a deterministic engine and given to you; report them, never infer them.
- NEVER invent case names, citations, dates or section numbers. If you were not given one, say you do not have it.
- GREY means "no opinion was formed", NOT "safe". Never describe a grey authority as clean or verified.
- Be brief and concrete. A working lawyer is reading this.
- Write in plain prose. No markdown headings, no bullet lists unless listing authorities.`;
