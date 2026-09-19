---
title: Questions and answers
description: The three question types, the typed answers they produce, and ask() for a model call with no policy.
---

A question is what a decision model is asked about a state. There are three types, and the answer type follows from the question type, so what you can read off an answer is checked at compile time.

```ts
import { ask, choice, noul, score } from "huncho";
import { jev } from "huncho/jev";

const { answers } = await ask(jev(), "The invoice is overdue and the card was declined twice.", {
  urgent: noul("Does this need a human within the hour?"),
  topic: choice("What is it about?", ["billing", "bug", "other"]),
  tone: score("How upset is the customer?", ["calm", "annoyed", "threatening to leave"]),
});

answers.urgent.p;            // 0.91
answers.urgent.yes;          // true
answers.topic.choice;        // "billing"
answers.topic.p("billing");  // 0.84
answers.tone.level;          // 1
```

`answers.topic.p("refund")` does not compile: `refund` was never offered. Answer helpers are typed to the question that produced them.

## The state

The first argument is what the model judges: a string, an object or an array. Objects are the usual case; put the fields that matter in and leave the rest out. A huncho does this with `shape`, and the journal hashes the state in stable JSON so key order does not matter.

## The three types

### noul

`noul(instructions, criteria?)` asks for the probability of yes. The answer has `p` in `[0, 1]` and `yes`, true from 0.5 up. `criteria` spells out what counts as yes and what counts as no when the instructions alone leave room:

```ts
noul("Does this need a human within the hour?", {
  true: "Money or access is blocked now.",
  false: "It can wait until tomorrow.",
});
```

A `p` near 0.5 means the model does not know. It is not "medium". Route it to a person rather than threshold it; [`uncertain`](policy.md#compose-helpers) makes that the easy path.

### choice

`choice(instructions, labels)` asks for one of a named set. Labels are a list, or a record from label to a description (`null` when the name is enough):

```ts
choice("What is it about?", ["billing", "bug", "other"]);
choice("How does the customer sound?", { calm: null, upset: "Threatens to leave or escalate." });
```

The answer has `choice`, the label with the highest probability; `probabilities`, one per label, summing to about 1; `confidence`, the probability of `choice`; `p(label)`; and `is(label, min?)`, true when `label` was chosen and its probability is at least `min` (default 0).

### score

`score(instructions, levels)` asks for a position on an ordered rubric, lowest level first, at least two levels:

```ts
score("How well does the passage answer the question?", [
  "off topic",
  "related, but does not answer it",
  "answers part of it",
  "answers it completely",
]);
```

The answer has `score`, the expected level index (fractional when the model hedges between levels); `level`, the nearest index; `ratio`, `score / (levels - 1)` in `[0, 1]`; `levels`, how many there are; `probabilities` per level index; and `confidence`, the probability of the nearest level. Fewer than two levels is a `ConfigError`.

## Answer helpers

| Question | Answer fields |
| --- | --- |
| `noul` | `p`, `yes` |
| `choice` | `choice`, `probabilities`, `confidence`, `p(label)`, `is(label, min?)` |
| `score` | `score`, `level`, `ratio`, `levels`, `probabilities`, `confidence` |

The types are exported: `NoulAnswer`, `ChoiceAnswer<L>`, `ScoreAnswer`, `AnswerOf<Q>` for one question and `Answers<Q>` for a record of them. `Answers<typeof questions>` is what a policy clause receives and what `ask` and `decide` return.

## ask()

`ask(model, state, questions, { signal? })` is one model call with no policy, no hysteresis and no journal: the building block a huncho is made of. It returns `{ answers, raw, usage, ms, provider, model }`. `raw` is the canonical answers as the model returned them, the shape a journal record carries. `signal` aborts the call, and the rejection is the signal's reason.

A huncho built with `.ask()` but not yet decided can do the same through `evaluate(input)`: the typed answers and what they cost, with no outcome. Use it to look at what the model says before writing clauses.

## Raw answers

Every provider returns answers in one canonical shape, keyed by question id: `{ type: "noul", noul }`, `{ type: "choice", choice, probabilities, confidence }` or `{ type: "score", score, probabilities, confidence, legend? }`. `wrapAnswers(raw, questions)` turns them into the typed answers above and is what `ask`, `decide` and `replay` call. A missing answer, an answer of the wrong type, a `noul` outside `[0, 1]` or a `score` outside the rubric is an `AnswerError` naming the question.
