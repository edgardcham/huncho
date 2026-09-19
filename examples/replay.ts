// Replay after a threshold change: journal a batch of decisions to a file, raise the bar,
// and see which outcomes move. The replay spends no tokens; it re-runs policy over the records.

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileJournal, huncho, jev, noul, readJournal, replay } from "../src/index.js";

const path = join(await mkdtemp(join(tmpdir(), "huncho-")), "decisions.jsonl");

const route = huncho("support.route", { model: jev(), journal: fileJournal(path) })
  .ask({ urgent: noul("Does this need a human within the hour?") })
  .when((a) => a.urgent.p, { enter: 0.5, exit: 0.4 }, "page")
  .else("wait");

const tickets = [
  { id: "T-2201", body: "Production database is refusing connections. Nothing works." },
  { id: "T-2202", body: "The export button is greyed out for one user on Safari." },
  { id: "T-2203", body: "A customer says they were charged twice this morning and wants a refund today." },
  { id: "T-2204", body: "Can we get dark mode? Not urgent, just asking." },
  { id: "T-2205", body: "Login is slow, maybe ten seconds, for everyone in the EU region." },
];

for (const ticket of tickets) {
  const decision = await route.decide(ticket.body, { key: ticket.id });
  console.log(`${ticket.id} urgent=${decision.answers.urgent.p.toFixed(2)} -> ${decision.outcome}`);
}

const stricter = route.with({ page: { enter: 0.8, exit: 0.6 } });
const result = replay(await readJournal(path), stricter);

console.log(`\nreplayed ${result.n} decisions with enter=0.8: ${result.changed} would change`);
for (const { record, outcome, changed } of result.results) {
  console.log(`${record.key} ${record.outcome} -> ${outcome}${changed ? "  (changed)" : ""}`);
}
