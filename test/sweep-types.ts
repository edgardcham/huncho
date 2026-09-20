import { huncho, memoryLabels, noul, sweep, type Label, type Labels, type JournalRecord, type Sweep } from "../src/index.js";
import { scriptedModel } from "huncho/testing";

function prove(records: JournalRecord[], rows: Label[], store: Labels, either: Labels | Label[]) {
  const route = huncho("support.route", { model: scriptedModel([{ answers: { urgent: { type: "noul", noul: 0.9 } } }]).model })
    .ask({ urgent: noul("Does this need a human within the hour?") })
    .when((a) => a.urgent.p, { enter: 0.8, exit: 0.6 }, "page")
    .else("wait");

  // No labels, a callback or a Label[] tabulate synchronously.
  const unscored: Sweep = sweep(records, route, { outcome: "page", enter: [0.7, 0.8] });
  const byCallback: Sweep = sweep(records, route, { outcome: "page", enter: [0.7, 0.8], labels: (rec) => rec.path.includes("page") });
  const byRows: Sweep = sweep(records, route, { outcome: "page", enter: [0.7, 0.8], labels: rows });

  // A Labels store has to be read, so the result is a promise.
  const byStore: Promise<Sweep> = sweep(records, route, { outcome: "page", enter: [0.7, 0.8], labels: store });
  const byMemory: Promise<Sweep> = sweep(records, route, { outcome: "page", enter: [0.7, 0.8], labels: memoryLabels() });

  // @ts-expect-error — a store is not tabulated synchronously
  const notSync: Sweep = sweep(records, route, { outcome: "page", enter: [0.7, 0.8], labels: store });

  // @ts-expect-error — rows are tabulated synchronously, not as a promise
  const notAsync: Promise<Sweep> = sweep(records, route, { outcome: "page", enter: [0.7, 0.8], labels: rows });

  // Not knowing which was passed means not knowing which comes back.
  const unknown: Sweep | Promise<Sweep> = sweep(records, route, { outcome: "page", enter: [0.7, 0.8], labels: either });

  // @ts-expect-error — the outcome has to be one the huncho declares
  const misspelt = sweep(records, route, { outcome: "pgae", enter: [0.7, 0.8] });

  // @ts-expect-error — precision is there only when labels were given, so it is optional on the row
  const precision: number = unscored.rows[0]?.precision;

  void unscored;
  void byCallback;
  void byRows;
  void byStore;
  void byMemory;
  void notSync;
  void notAsync;
  void unknown;
  void misspelt;
  void precision;
}

void prove;
