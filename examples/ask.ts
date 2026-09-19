import { ask, choice, jev, noul } from "../src/index.js";

const { answers } = await ask(
  jev(),
  "The invoice is overdue and the customer's card was declined twice.",
  {
    urgent: noul("Does this need a human within the hour?"),
    topic: choice("What is it about?", ["billing", "bug", "other"]),
  },
);

console.log({
  urgent: { p: answers.urgent.p, yes: answers.urgent.yes },
  topic: { choice: answers.topic.choice, billing: answers.topic.p("billing") },
});
