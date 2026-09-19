// Journal seam: append-only records, stable hashing, the memory adapter.
// Hash algorithm and key order live here; callers store or compare hex digests.
// The file adapter is in node.ts, the entry for code that touches the filesystem.

import type { RawAnswer, State, Usage } from "./types.js";

/**
 * One decided evaluation. Language-neutral v1 contract; see docs/journal.md.
 * Plain JSON: a huncho writes one per decision, `replay` and `calibrate` read
 * them back, and a port in another language reads the same lines.
 *
 * Adding a field is a minor version. Renaming or removing one is a major.
 * `state` is opt-in: omit it unless the caller asked to keep the payload.
 *
 * @example
 * ```ts
 * import type { JournalRecord } from "huncho";
 *
 * const record: JournalRecord = {
 *   t: "2026-09-19T12:00:00.000Z",
 *   huncho: "support.route",
 *   key: "T-1041",
 *   provider: "jev",
 *   model: "jev-latest",
 *   stateHash: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
 *   questionsHash: "2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae",
 *   answers: { urgent: { type: "noul", noul: 0.91 } },
 *   outcome: "page",
 *   path: ["page"],
 *   usage: { inputTokens: 412, outputTokens: 38 },
 *   ms: 640,
 * };
 * ```
 */
export interface JournalRecord {
  /** ISO-8601 timestamp. */
  readonly t: string;
  /** Huncho name that produced the record. */
  readonly huncho: string;
  /** Hysteresis key (the entity the decision is about). */
  readonly key: string;
  /** Name of the provider that answered. */
  readonly provider: string;
  /** Id of the model that answered. */
  readonly model: string;
  /** SHA-256 hex of the state in stable JSON. Equal states hash equal; the state itself need not be kept. */
  readonly stateHash: string;
  /** SHA-256 hex of the questions in stable JSON, so a replay can tell when the questions changed. */
  readonly questionsHash: string;
  /** The state itself, only when the journal was asked to keep it. */
  readonly state?: State;
  /** Canonical raw answers, keyed by question id. */
  readonly answers: Record<string, RawAnswer>;
  /** This huncho's own outcome, before any nested branch. */
  readonly outcome: string;
  /** Outcome held for `key` before this decision, if any. */
  readonly previous?: string;
  /** Root outcome down through nested branch outcomes. */
  readonly path: readonly string[];
  /** Tokens this huncho's own call consumed. */
  readonly usage: Usage;
  /** Wall-clock milliseconds for this huncho's own call. */
  readonly ms: number;
}

/**
 * Where decisions are written. Two adapters ship: `memoryJournal()` and, from
 * `huncho/node`, `fileJournal(path)`. Implement it to send records anywhere
 * else; `write` may be sync or async, and a huncho awaits it before resolving.
 *
 * @example
 * ```ts
 * import type { Journal, JournalRecord } from "huncho";
 *
 * const records: JournalRecord[] = [];
 * const logged: Journal = {
 *   write(rec) {
 *     records.push(rec);
 *     console.log(rec.huncho, rec.key, rec.outcome);
 *   },
 *   async read() {
 *     return records;
 *   },
 * };
 * ```
 */
export interface Journal {
  /** Append one record. A huncho awaits the returned promise, if any. */
  write(rec: JournalRecord): void | Promise<void>;
  /** Every record written so far, in order. */
  read(): Promise<JournalRecord[]>;
}

/**
 * In-memory journal. `records` is write order; `read` returns deep copies.
 * For tests and for scripts that replay in the same process.
 *
 * @example
 * ```ts
 * import { huncho, memoryJournal, noul } from "huncho";
 * import { scriptedModel } from "huncho/testing";
 *
 * const journal = memoryJournal();
 * const { model } = scriptedModel([{ answers: { urgent: { type: "noul", noul: 0.91 } } }]);
 * const route = huncho("support.route", { model, journal })
 *   .ask({ urgent: noul("Does this need a human within the hour?") })
 *   .else("wait");
 *
 * await route.decide("Checkout is down.");
 * journal.records.length;      // 1
 * journal.records[0]?.outcome; // "wait"
 * ```
 */
export function memoryJournal(): Journal & {
  /** Every record written, in order. The live array, not a copy. */
  records: JournalRecord[];
} {
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

/**
 * JSON with object keys sorted at every depth, so equal values serialise
 * equal whatever order their keys were written in. This is what `stateHash`
 * and `questionsHash` are computed over. Honors `toJSON(key)` once per value.
 *
 * @example
 * ```ts
 * import { stableStringify } from "huncho";
 *
 * stableStringify({ b: 1, a: [{ d: 2, c: 3 }] }); // '{"a":[{"c":3,"d":2}],"b":1}'
 * stableStringify({ a: 1, b: 2 }) === stableStringify({ b: 2, a: 1 }); // true
 * ```
 */
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

/**
 * SHA-256 hex digest of `text` via WebCrypto. With `stableStringify`, this is
 * how a journal's `stateHash` is computed, so you can check a record against
 * the state you still have.
 *
 * @example
 * ```ts
 * import { sha256, stableStringify } from "huncho";
 *
 * const state = { subject: "Checkout is down", body: "Every customer gets a 500." };
 * const hash = await sha256(stableStringify(state)); // 64 hex characters
 * hash.length; // 64
 * ```
 */
export async function sha256(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
