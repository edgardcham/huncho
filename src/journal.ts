// Journal seam: append-only records, stable hashing, the memory adapter.
// Hash algorithm and key order live here; callers store or compare hex digests.
// The file adapter is in node.ts, the entry for code that touches the filesystem.

import type { RawAnswer, State, Usage } from "./types.js";

/**
 * One decided evaluation. Language-neutral v1 contract; see docs/journal.md.
 *
 * Adding a field is a minor version. Renaming or removing one is a major.
 * `state` is opt-in: omit it unless the caller asked to keep the payload.
 */
export interface JournalRecord {
  /** ISO-8601 timestamp. */
  readonly t: string;
  /** Huncho name that produced the record. */
  readonly huncho: string;
  /** Hysteresis key (the entity the decision is about). */
  readonly key: string;
  readonly provider: string;
  readonly model: string;
  readonly stateHash: string;
  readonly questionsHash: string;
  readonly state?: State;
  /** Canonical raw answers, keyed by question id. */
  readonly answers: Record<string, RawAnswer>;
  readonly outcome: string;
  /** Outcome held for `key` before this decision, if any. */
  readonly previous?: string;
  /** Root outcome down through nested branch outcomes. */
  readonly path: readonly string[];
  readonly usage: Usage;
  readonly ms: number;
}

export interface Journal {
  write(rec: JournalRecord): void | Promise<void>;
  read(): Promise<JournalRecord[]>;
}

/** In-memory journal. `records` is write order; `read` returns deep copies. */
export function memoryJournal(): Journal & { records: JournalRecord[] } {
  const records: JournalRecord[] = [];
  return {
    records,
    write(rec) {
      records.push(structuredClone(rec));
    },
    async read() {
      return records.map((rec) => structuredClone(rec));
    },
  };
}

/** JSON with object keys sorted, so equal values hash equal. Honors `toJSON(key)` once per value. */
export function stableStringify(value: unknown): string {
  return encode("", { "": value }) ?? "null";
}

function encode(key: string, holder: object): string | undefined {
  let value: unknown = (holder as Record<string, unknown>)[key];
  if (value !== null && typeof value === "object") {
    const toJSON = (value as { toJSON?: (k: string) => unknown }).toJSON;
    if (typeof toJSON === "function") value = toJSON.call(value, key);
  }
  if (value === undefined || typeof value === "function" || typeof value === "symbol") return undefined;
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) {
    const items: string[] = [];
    for (let i = 0; i < value.length; i++) items.push(encode(String(i), value) ?? "null");
    return `[${items.join(",")}]`;
  }
  const rec = value as Record<string, unknown>;
  const parts: string[] = [];
  for (const k of Object.keys(rec).sort()) {
    const item = encode(k, rec);
    if (item === undefined) continue;
    parts.push(`${JSON.stringify(k)}:${item}`);
  }
  return `{${parts.join(",")}}`;
}

/** SHA-256 hex digest of `text` via WebCrypto. */
export async function sha256(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
