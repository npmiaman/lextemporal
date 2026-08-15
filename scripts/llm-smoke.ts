import { Type } from "@google/genai";
import { llmJson } from "../lib/llm";

async function main() {
  const schema = {
    type: Type.OBJECT,
    properties: {
      answer: { type: Type.STRING },
      confidence: { type: Type.NUMBER },
    },
    required: ["answer", "confidence"],
  };
  const r1 = await llmJson<{ answer: string; confidence: number }>(
    "In one sentence: what did the Specific Relief (Amendment) Act 2018 change about Section 10?",
    schema
  );
  console.log("fromCache:", r1.fromCache, "| answer:", r1.data.answer.slice(0, 140));
  const r2 = await llmJson("In one sentence: what did the Specific Relief (Amendment) Act 2018 change about Section 10?", schema);
  console.log("second call fromCache:", r2.fromCache);
}
main().catch((e) => { console.error("FAIL", e); process.exit(1); });
