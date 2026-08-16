// Chat persistence for the workspace shell.
//
// The sidebar was listing rows from the `matters` table, which nothing in the
// conversational flow ever writes — so it always read "No chats yet" no matter
// how much work had been done. A matter row needs a title, a filing number and
// a timeline before it can exist; a conversation needs none of those, and
// demanding them before the lawyer has said anything is the wizard the AI-native
// surface was built to remove.
//
// So a chat is created the moment one is started, kept in localStorage, and
// named from the papers once they arrive. It stays local on purpose: the
// transcript contains the client's case papers, and this is the one store in the
// app that never needs to leave the machine.

import type { Message, UploadedDoc } from "@/lib/workspace";
import type { ArtifactTab } from "@/components/artifact-panel";
import type { Hearing } from "@/lib/courtroom";

export interface ChatAuthority {
  cnr: string;
  title: string;
  date: string;
  citation: string;
  color: string;
  reason: string;
}

export interface ChatState {
  messages: Message[];
  docs: UploadedDoc[];
  authorities: ChatAuthority[];
  tabs: ArtifactTab[];
  hearing: Hearing | null;
}

export interface Chat {
  id: number;
  title: string;
  createdAt: string;
  updatedAt: string;
  state: ChatState;
}

const KEY = "lextemporal-chats";

export const emptyState = (): ChatState => ({
  messages: [],
  docs: [],
  authorities: [],
  tabs: [],
  hearing: null,
});

export function loadChats(): Chat[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Chat[];
    return Array.isArray(parsed)
      ? parsed.map((c) => ({ ...c, state: { ...emptyState(), ...c.state } }))
      : [];
  } catch {
    // A corrupt store must not take the app down with it.
    return [];
  }
}

export function saveChats(chats: Chat[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(chats));
  } catch {
    // Quota, most likely a very long transcript. The session still works; only
    // the persistence is lost, and failing the render over it would be worse.
  }
}

const FILING =
  /\b(?:CS|OMP|ARB|CRL|CM|FAO|RFA|LPA|WP|SLP|CA|CO|EX|TA)[\s.]*(?:\([A-Z.]{1,8}\))?[\s.]*(?:No\.?\s*)?\d{1,6}\s*(?:of|\/)\s*\d{2,4}\b/i;

/**
 * Name a chat from what the lawyer actually typed.
 *
 * A filing number is what they recognise the matter by, so it wins whenever the
 * papers contain one. Otherwise the first line, trimmed — never a generated
 * title, because naming costs a model call and gets it wrong often enough to be
 * annoying on something the user cannot see being decided.
 */
export function titleFor(text: string): string {
  const filing = FILING.exec(text);
  if (filing) return filing[0].replace(/\s+/g, " ").trim();
  const firstLine = text.trim().split(/\n/).find((l) => l.trim().length > 2) ?? text.trim();
  const clean = firstLine.replace(/\s+/g, " ").trim();
  return clean.length > 44 ? `${clean.slice(0, 44).trimEnd()}…` : clean || "New matter";
}
