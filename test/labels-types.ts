import { calibrate, memoryLabels, type Calibration, type JournalRecord, type Label, type Labels } from "../src/index.js";

function prove(records: JournalRecord[], rows: Label[], store: Labels, either: Labels | Label[]) {
  // A callback or a Label[] scores synchronously.
  const byCallback: Calibration = calibrate(records, { question: "urgent", outcome: (rec) => rec.path.includes("page") });
  const byRows: Calibration = calibrate(records, { question: "urgent", outcome: rows });

  // A Labels store has to be read, so the result is a promise.
  const byStore: Promise<Calibration> = calibrate(records, { question: "urgent", outcome: store });
  const byMemory: Promise<Calibration> = calibrate(records, { question: "urgent", outcome: memoryLabels() });

  // @ts-expect-error — a store is not scored synchronously
  const notSync: Calibration = calibrate(records, { question: "urgent", outcome: store });

  // @ts-expect-error — rows are scored synchronously, not as a promise
  const notAsync: Promise<Calibration> = calibrate(records, { question: "urgent", outcome: rows });

  // Not knowing which was passed means not knowing which comes back.
  const unknown: Calibration | Promise<Calibration> = calibrate(records, { question: "urgent", outcome: either });

  // @ts-expect-error — truth is a boolean, a string or a number
  const wrong: Label = { id: "a", t: "2026-09-19T15:00:00.000Z", truth: null };

  void byCallback;
  void byRows;
  void byStore;
  void byMemory;
  void notSync;
  void notAsync;
  void unknown;
  void wrong;
}

void prove;
