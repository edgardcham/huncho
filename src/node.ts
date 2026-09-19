// huncho/node: the file journal, the one part of the package that reads and writes the filesystem.
// node:fs/promises is imported on first use, so the root entry can re-export this and still load without it.

import type { Journal, JournalRecord } from "./journal.js";

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
