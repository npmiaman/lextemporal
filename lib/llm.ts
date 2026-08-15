// Thin Gemini wrapper. ALL engines call this — never the SDK directly — so the
// provider is swappable in this one file. temperature 0, native JSON mode
// (responseMimeType + responseSchema), and every response cached in llm_cache
// by SHA256(model + prompt) — the cache is the demo's safety net.

import crypto from "crypto";
import { GoogleGenAI, type Schema } from "@google/genai";
import { getDb, nowIso } from "@/lib/db";

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

export function llmModel(): string {
  return process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
}

export class LlmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmError";
  }
}

function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

export interface LlmCallOptions {
  /** Vary the cache key for otherwise-identical prompts (e.g. simulation run index). */
  cacheSalt?: string;
  /** Network-kill mode: serve cache or fail, never call out. */
  allowNetwork?: boolean;
}

/**
 * JSON-mode completion, cache-first. Returns the parsed object.
 * The responseSchema makes Gemini return schema-valid JSON server-side;
 * the JSON.parse guard below is the backup.
 */
export async function llmJson<T>(
  prompt: string,
  responseSchema: Schema,
  opts: LlmCallOptions = {}
): Promise<{ data: T; fromCache: boolean }> {
  const db = getDb();
  const model = llmModel();
  const hash = sha256(`${model}::${prompt}::${opts.cacheSalt ?? ""}`);

  const cached = db.prepare("SELECT response FROM llm_cache WHERE hash = ?").get(hash) as
    | { response: string }
    | undefined;
  if (cached) {
    return { data: JSON.parse(cached.response) as T, fromCache: true };
  }
  if (opts.allowNetwork === false) {
    throw new LlmError("LLM cache miss in network-kill mode");
  }

  // Free-tier Gemini is rate-limited per minute; back off and retry on 429/503
  // so seed-demo can grind through its batch instead of dying mid-warm.
  let text: string | undefined;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await getClient().models.generateContent({
        model,
        contents: prompt,
        config: {
          temperature: 0,
          responseMimeType: "application/json",
          responseSchema,
        },
      });
      text = res.text;
      lastErr = undefined;
      break;
    } catch (e) {
      lastErr = e;
      const msg = String(e);
      const retryable = /429|RESOURCE_EXHAUSTED|503|UNAVAILABLE|overloaded/i.test(msg);
      if (!retryable || attempt === 3) break;
      const waitMs = 15000 * (attempt + 1);
      console.warn(`[llm] retryable error (attempt ${attempt + 1}), waiting ${waitMs / 1000}s`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  if (lastErr) throw new LlmError(`Gemini call failed: ${String(lastErr)}`);
  if (!text) throw new LlmError("Gemini returned an empty response");

  let data: T;
  try {
    data = JSON.parse(text) as T;
  } catch {
    // Parse guard: strip accidental markdown fences before giving up.
    const stripped = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    try {
      data = JSON.parse(stripped) as T;
    } catch {
      throw new LlmError(`Gemini returned non-JSON despite JSON mode: ${text.slice(0, 200)}`);
    }
  }

  db.prepare(
    "INSERT OR REPLACE INTO llm_cache (hash, model, prompt, response, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(hash, model, prompt, JSON.stringify(data), nowIso());
  return { data, fromCache: false };
}
