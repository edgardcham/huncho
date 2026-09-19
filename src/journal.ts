// Journal seam: append-only records, stable hashing, memory and file adapters.
// Hash algorithm and key order live here; callers store or compare hex digests.

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

/**
 * JSONL file journal. Writes are serialised in call order.
 * `state` is written only when `includeState` is true.
 */
export function fileJournal(
  path: string,
  options?: { readonly includeState?: boolean },
): Journal {
  const includeState = options?.includeState === true;
  const enqueue = serialQueue();
  return {
    write(rec) {
      const line = `${JSON.stringify(includeState ? rec : omitState(rec))}\n`;
      return enqueue(async () => {
        const fs = await nodeFs();
        await fs.appendFile(path, line);
      });
    },
    read() {
      return enqueue(() => readJournal(path));
    },
  };
}

/** Read a JSONL journal from disk. A missing file is an empty list. */
export async function readJournal(path: string): Promise<JournalRecord[]> {
  const fs = await nodeFs();
  let text: string;
  try {
    text = await fs.readFile(path, "utf8");
  } catch (err) {
    if (isNotFound(err)) return [];
    throw err;
  }
  const lines = text.split(/\r?\n/);
  const records: JournalRecord[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined || line === "") continue;
    try {
      records.push(JSON.parse(line) as JournalRecord);
    } catch (err) {
      const later = lines.slice(i + 1).some((next) => next !== "");
      if (later) throw err;
      break;
    }
  }
  return records;
}

function omitState(rec: JournalRecord): JournalRecord {
  if (!Object.hasOwn(rec, "state")) return rec;
  const { state: _state, ...rest } = rec;
  return rest;
}

function serialQueue(): <T>(work: () => Promise<T>) => Promise<T> {
  let tail: Promise<void> = Promise.resolve();
  return (work) => {
    const run = tail.then(work);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}

function isNotFound(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT";
}

function nodeFs(): Promise<typeof import("node:fs/promises")> {
  return import("node:fs/promises");
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
