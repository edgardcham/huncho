// Labels close the loop: journal decisions, record what actually happened for each one by
// its id when the truth arrives, and calibrate with no hand-written join. Both files are
// append-only JSONL, so the labels can be written days later by a different process.

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { calibrate, fileJournal, fileLabels, huncho, jev, noul, readJournal } from "../src/index.js";

const dir = await mkdtemp(join(tmpdir(), "huncho-"));
const journal = fileJournal(join(dir, "decisions.jsonl"));
const labels = fileLabels(join(dir, "labels.jsonl"));

const route = huncho("support.route", { model: jev(), journal })
  .ask({ urgent: noul("Does this need a human within the hour?") })
  .when((a) => a.urgent.p, { enter: 0.7, exit: 0.5 }, "page")
  .else("wait");

// What the model decided, then what the on-call engineer actually did: `paged` is the truth
// a support desk learns after the fact, from the incident log rather than from the model.
const tickets = [
  { id: "T-3101", body: "Production database is refusing connections. Nothing works.", paged: true },
  { id: "T-3102", body: "The export button is greyed out for one user on Safari.", paged: false },
  { id: "T-3103", body: "A customer says they were charged twice and wants a refund today.", paged: false },
  { id: "T-3104", body: "Can we get dark mode? Not urgent, just asking.", paged: false },
  { id: "T-3105", body: "Login is slow, maybe ten seconds, for everyone in the EU region.", paged: true },
  { id: "T-3106", body: "Password reset emails are not arriving for any customer since noon.", paged: true },
];

for (const ticket of tickets) {
  const decision = await route.decide(ticket.body, { key: ticket.id });
  console.log(`${ticket.id} urgent=${decision.answers.urgent.p.toFixed(2)} -> ${decision.outcome}`);

  // When the truth arrives, label the decision by its id. Only `id`, `t` and `truth` are needed.
  await labels.write({ id: decision.id, t: new Date().toISOString(), truth: ticket.paged });
}

// Later, anywhere the two files are readable: the join by id is calibrate's.
const c = await calibrate(await readJournal(join(dir, "decisions.jsonl")), { question: "urgent", outcome: labels });

console.log(`\nscored ${c.n} decisions: brier=${c.brier.toFixed(3)} baseBrier=${c.baseBrier.toFixed(3)} baseRate=${c.baseRate.toFixed(2)}`);
console.log(c.brier < c.baseBrier ? "the probabilities beat the base rate" : "the probabilities do not beat the base rate");
for (const row of c.reliability) {
  console.log(`p in [${row.lo.toFixed(1)}, ${row.hi.toFixed(1)}): n=${row.n} predicted=${row.meanP.toFixed(2)} observed=${row.observed.toFixed(2)}`);
}
