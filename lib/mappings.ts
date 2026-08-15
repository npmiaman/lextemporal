import { z } from "zod";
import rawMappings from "@/data/mappings.json";

export const MappingSchema = z.object({
  id: z.string().regex(/^M\d+$/),
  act_old: z.string().min(3),
  provision_old: z.string().min(1),
  act_new: z.string().min(3),
  provision_new: z.string().min(1),
  change_type: z.enum([
    "substantive_amendment",
    "renumbering_only",
    "insertion",
    "succession",
  ]),
  commencement: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  applies_when: z.enum(["cause_or_suit_after_commencement", "trial_on_or_after"]),
  note: z.string().min(5),
  source_url: z.string().url(),
});

export type StatuteMapping = z.infer<typeof MappingSchema>;

function validate(): StatuteMapping[] {
  const parsed = z.array(MappingSchema).min(1).safeParse(rawMappings);
  if (!parsed.success) {
    // Fail loudly on boot: a malformed statute graph must never silently degrade flags.
    throw new Error(
      `data/mappings.json failed validation:\n${JSON.stringify(parsed.error.issues, null, 2)}`
    );
  }
  const ids = new Set<string>();
  for (const m of parsed.data) {
    if (ids.has(m.id)) throw new Error(`data/mappings.json: duplicate id ${m.id}`);
    ids.add(m.id);
  }
  return parsed.data;
}

export const mappings: StatuteMapping[] = validate();

export function getMapping(id: string): StatuteMapping | undefined {
  return mappings.find((m) => m.id === id);
}

/** Most recent commencement date in the graph — shown as "Law data current as of". */
export const lawDataCurrentAsOf = mappings
  .map((m) => m.commencement)
  .sort()
  .at(-1)!;
