import { huncho, noul, type Model } from "../src/index.js";

declare const model: Model;

const route = huncho("support.route", { model })
  .shape((ticket: { id: string }) => ticket.id)
  .ask({ urgent: noul("Does this need a human within the hour?") })
  .when((a) => a.urgent.p, { enter: 0.8, exit: 0.6 }, "page")
  .when((a) => a.urgent.yes, "billing")
  .else("wait");

async function prove() {
  const decision = await route.decide({ id: "ticket-1" });
  const outcome: "page" | "billing" | "wait" = decision.outcome;

  // @ts-expect-error — decide returns the accumulated outcome union
  const onlyPage: "page" = decision.outcome;

  // @ts-expect-error — shape input is the ticket, not a raw state string
  await route.decide("plain");

  const reset = huncho("support.route", { model })
    .ask({ urgent: noul("Does this need a human within the hour?") })
    .when((a) => a.urgent.p, { enter: 0.8 }, "page")
    .ask({ mood: noul("Is the customer upset?") })
    .else("wait");
  const restarted = await reset.decide({ id: "ticket-1" });
  const onlyWait: "wait" = restarted.outcome;

  // @ts-expect-error — ask() starts a new policy
  const lostPage: "page" = restarted.outcome;

  void outcome;
  void onlyPage;
  void onlyWait;
  void lostPage;
}

void prove;
void route;
