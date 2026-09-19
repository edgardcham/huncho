import { test } from "node:test";
import assert from "node:assert/strict";
import { HunchoError, noul } from "../src/index.js";
import { scriptedModel } from "../src/testing.js";

const questions = {
  urgent: noul("Does this need a human within the hour?"),
};

test("scriptedModel records requests and answers in order; the last entry repeats", async () => {
  const { model, requests } = scriptedModel([
    { answers: { urgent: { type: "noul", noul: 0.1 } } },
    { answers: { urgent: { type: "noul", noul: 0.9 } } },
  ]);

  assert.equal(model.provider, "scripted");
  assert.equal(model.id, "scripted");

  const first = await model.evaluate({ state: "one", questions });
  const second = await model.evaluate({ state: "two", questions });
  const third = await model.evaluate({ state: { n: 3 }, questions });

  assert.deepEqual(first.answers, { urgent: { type: "noul", noul: 0.1 } });
  assert.deepEqual(second.answers, { urgent: { type: "noul", noul: 0.9 } });
  assert.deepEqual(third.answers, { urgent: { type: "noul", noul: 0.9 } });
  assert.deepEqual(
    requests.map((request) => request.state),
    ["one", "two", { n: 3 }],
  );
  assert.equal(requests[0]?.questions, questions);
  assert.deepEqual(first.usage, { inputTokens: 0, outputTokens: 0 });
});

test("scriptedModel rejects an empty script", () => {
  assert.throws(
    () => scriptedModel([]),
    (err: unknown) => {
      assert.equal(err instanceof HunchoError, true);
      assert.equal((err as HunchoError).provider, "scripted");
      return true;
    },
  );
});
