/**
 * huncho/node: the file journal, the one part of the package that reads and writes the filesystem.
 * node:fs/promises is imported on first use, so the root entry can re-export this and still load without it.
 *
 * @module huncho/node
 */

import type { Journal, JournalRecord } from "./journal.js";

/**
 * JSONL file journal: one record per line, appended. Writes are serialised in
 * call order, and `node:fs/promises` is imported on first write, so importing
 * this entry costs nothing. `state` is written only when `includeState` is true.
 *
 * @param path File to append to. Created on first write.
 * @param options `includeState` keeps the full state on every record; off by default because states can be large or private.
 * @example
 * ```ts
 * import { huncho, noul } from "huncho";
 * import { jev } from "huncho/jev";
 * import { fileJournal } from "huncho/node";
 *
 * const route = huncho("support.route", { model: jev(), journal: fileJournal("decisions.jsonl") })
 *   .ask({ urgent: noul("Does this need a human within the hour?") })
 *   .when((a) => a.urgent.p, { enter: 0.8, exit: 0.6 }, "page")
 *   .else("wait");
 *
 * await route.decide("Checkout is down.", { key: "T-1041" }); // appends one line
 * ```
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

/**
 * Read a JSONL journal from disk. A missing file is an empty list. A last
 * line that is not JSON and has no trailing newline is taken for a
 * half-written append and skipped; any other line that is not JSON throws.
 *
 * @example
 * ```ts
 * import { huncho, noul, replay } from "huncho";
 * import { jev } from "huncho/jev";
 * import { readJournal } from "huncho/node";
 *
 * const route = huncho("support.route", { model: jev() })
 *   .ask({ urgent: noul("Does this need a human within the hour?") })
 *   .when((a) => a.urgent.p, { enter: 0.8, exit: 0.6 }, "page")
 *   .else("wait");
 *
 * const records = await readJournal("decisions.jsonl");
 * replay(records, route.with({ page: { enter: 0.9, exit: 0.7 } })).changed;
 * ```
 */
export async function readJournal(path: string): Promise<JournalRecord[]> {
  const fs = await nodeFs();
  let text: string;
  try {
    text = await fs.readFile(path, "utf8");
  } catch (err) {
    if (isNotFound(err)) return [];
    throw err;
  }
  const complete = text.endsWith("\n");
  const lines = text.split(/\r?\n/);
  const records: JournalRecord[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined || line === "") continue;
    try {
      records.push(JSON.parse(line) as JournalRecord);
    } catch (err) {
      const later = lines.slice(i + 1).some((next) => next !== "");
      if (!complete && !later) break;
      throw err;
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
