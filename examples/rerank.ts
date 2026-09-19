// Reranking with a score question: score every candidate on one rubric, then sort in code.
// One model call per candidate, all in flight at once.

import { ask, jev, score } from "../src/index.js";

const question = "How do I rotate my API key without downtime?";

const passages = [
  "API keys live under Settings, then Keys. Each key shows its name and the date it was created.",
  "To rotate a key, create a second key, deploy it, then revoke the first. Both stay valid until you revoke one.",
  "Downtime notifications go to the account owner's email address.",
  "To revoke a key, click Revoke next to it. Requests that still use it fail immediately.",
];

const fit = score("How well does the passage answer the question?", [
  "off topic",
  "related, but does not answer it",
  "answers part of it",
  "answers it completely",
]);

const model = jev();

const ranked = await Promise.all(
  passages.map(async (passage) => {
    const { answers } = await ask(model, { question, passage }, { fit });
    return { passage, fit: answers.fit };
  }),
);

ranked.sort((a, b) => b.fit.score - a.fit.score || b.fit.confidence - a.fit.confidence);

for (const { passage, fit } of ranked) {
  console.log(`${fit.score.toFixed(2)} level ${fit.level}/${fit.levels - 1}  ${passage}`);
}
