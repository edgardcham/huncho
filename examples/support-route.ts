// Support routing with hysteresis: one ticket, three updates, a threshold that does not flap.
// The same key across calls lets "page" hold while urgency dips below the entry threshold.

import { choice, huncho, jev, noul } from "../src/index.js";

type Ticket = { id: string; subject: string; body: string };

const route = huncho("support.route", { model: jev() })
  .shape((ticket: Ticket) => ({ subject: ticket.subject, body: ticket.body }))
  .ask({
    urgent: noul("Does this need a human within the hour?"),
    topic: choice("What is it about?", ["billing", "bug", "other"]),
  })
  .when((a) => a.urgent.p, { enter: 0.8, exit: 0.6 }, "page")
  .when((a) => a.topic.is("billing", 0.7), "billing")
  .else("triage");

const updates: Ticket[] = [
  {
    id: "T-1041",
    subject: "Checkout is down",
    body: "Every customer gets a 500 at payment since 09:00. We are losing orders right now.",
  },
  {
    id: "T-1041",
    subject: "Checkout is down",
    body: "Most customers can pay again. A few still see the error when they retry.",
  },
  {
    id: "T-1041",
    subject: "Checkout is down",
    body: "All clear on our side. Filing this so the incident is on record.",
  },
];

for (const ticket of updates) {
  const decision = await route.decide(ticket, { key: ticket.id });
  console.log(
    `${ticket.id} urgent=${decision.answers.urgent.p.toFixed(2)} topic=${decision.answers.topic.choice}`,
    `previous=${decision.previous ?? "none"} -> ${decision.outcome}`,
  );
}
