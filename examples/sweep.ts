// Sweep: which threshold to pick, from the journal. Decisions are journaled and labelled with
// what actually happened; then every candidate enter and exit is replayed over the journal, with
// the flap cost of each pair and precision and recall against the labels. The sweep spends no
// tokens; only the decisions that fill the journal do.

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileJournal, fileLabels, huncho, jev, noul, readJournal, sweep } from "../src/index.js";

const dir = await mkdtemp(join(tmpdir(), "huncho-"));
const journal = fileJournal(join(dir, "decisions.jsonl"));
const labels = fileLabels(join(dir, "labels.jsonl"));

const route = huncho("support.route", { model: jev(), journal })
  .ask({ urgent: noul("Does this need a human within the hour?") })
  .when((a) => a.urgent.p, { enter: 0.7, exit: 0.5 }, "page")
  .else("wait");

// Messages arrive over time; a ticket is the hysteresis key, so its follow-ups see the outcome it
// last got. `paged` is what the on-call engineer actually did, known only after the fact.
const messages = [
  { key: "T-4101", body: "Production database is refusing connections. Nothing works.", paged: true },
  { key: "T-4102", body: "The export button is greyed out for one user on Safari.", paged: false },
  { key: "T-4101", body: "Update: connections are back for most customers, a few still failing.", paged: true },
  { key: "T-4103", body: "Login is slow, maybe ten seconds, for everyone in the EU region.", paged: true },
  { key: "T-4101", body: "Update: all connections restored, monitoring for an hour.", paged: true },
  { key: "T-4104", body: "Can we get dark mode? Not urgent, just asking.", paged: false },
  { key: "T-4103", body: "Update: login is back to normal speed in the EU.", paged: false },
  { key: "T-4105", body: "A customer says they were charged twice and wants a refund today.", paged: false },
];

for (const message of messages) {
  const decision = await route.decide(message.body, { key: message.key });
  console.log(`${message.key} urgent=${decision.answers.urgent.p.toFixed(2)} -> ${decision.outcome} (${decision.via})`);
  await labels.write({ id: decision.id, t: new Date().toISOString(), truth: message.paged });
}

// Every enter from 0.5 to 0.9 against every exit from 0.3 to 0.9, the pairs with exit above enter
// left out, plus today's { enter: 0.7, exit: 0.5 } marked current. One replay per pair, no model call.
const result = await sweep(await readJournal(join(dir, "decisions.jsonl")), route, {
  outcome: "page",
  enter: { from: 0.5, to: 0.9, step: 0.1 },
  exit: { from: 0.3, to: 0.9, step: 0.1 },
  labels,
});

console.log("\n  enter exit  chosen flaps precision recall f1");
for (const row of result.rows) {
  const mark = row.current ? "*" : " ";
  const score = (value: number | undefined) => (value === undefined ? "  -  " : value.toFixed(2).padStart(5));
  console.log(
    `${mark} ${row.enter.toFixed(1)}   ${row.exit.toFixed(1)}   ${String(row.chosen).padStart(2)}/${row.n}   ${String(row.flaps).padStart(2)}    ${score(row.precision)}    ${score(row.recall)} ${score(row.f1)}`,
  );
}
if (result.best !== undefined) {
  console.log(`\nbest by f1, ties to fewer flaps: enter=${result.best.enter} exit=${result.best.exit} (today: enter=0.7 exit=0.5)`);
}
