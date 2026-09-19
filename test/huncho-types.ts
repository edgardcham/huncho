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

  const child = huncho("support.escalate", { model })
    .ask({ human: noul("Should a person take this?") })
    .when((a) => a.human.p, { enter: 0.8 }, "page")
    .else("queue");
  const branched = huncho("support.route", { model })
    .ask({ urgent: noul("Does this need a human within the hour?") })
    .when((a) => a.urgent.p, { enter: 0.8 }, "escalate")
    .else("wait")
    .branch({ escalate: child, wait: null });
  const nested = await branched.decide({ id: "ticket-1" });
  const branchedOutcome: "escalate" | "wait" | "page" | "queue" = nested.outcome;
  const page: typeof nested.outcome = "page";
  const queue: typeof nested.outcome = "queue";

  switch (nested.outcome) {
    case "escalate":
    case "wait":
    case "page":
    case "queue":
      break;
    default: {
      const exhausted: never = nested.outcome;
      void exhausted;
    }
  }

  // @ts-expect-error — decide includes child outcomes in the union
  const parentOnly: "escalate" | "wait" = nested.outcome;

  // @ts-expect-error — unknown outcomes are not in the union
  const stranger: typeof nested.outcome = "other";

  const mismatched = huncho("support.escalate", { model })
    .shape((n: number) => String(n))
    .ask({ human: noul("Should a person take this?") })
    .else("queue");

  huncho("support.route", { model })
    .shape((ticket: { id: string }) => ticket.id)
    .ask({ urgent: noul("Does this need a human within the hour?") })
    .when((a) => a.urgent.p, { enter: 0.8 }, "escalate")
    .else("wait")
    .branch({
      // @ts-expect-error — a shaped child must accept the parent's input
      escalate: mismatched,
    });

  // @ts-expect-error — shape after branch would change the input under the children
  branched.shape((ticket: { id: string }) => ticket.id);

  // @ts-expect-error — with() only overrides parent policy outcomes
  branched.with({ page: { enter: 0.9 } });
  const parentOverride = branched.with({ escalate: { enter: 0.85 } });

  void outcome;
  void onlyPage;
  void onlyWait;
  void lostPage;
  void branchedOutcome;
  void page;
  void queue;
  void parentOnly;
  void stranger;
  void mismatched;
  void parentOverride;
}

void prove;
void route;
