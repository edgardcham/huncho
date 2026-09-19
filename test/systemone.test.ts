import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { HunchoError, type EvaluateRequest } from "../src/index.js";
import { systemone } from "../src/systemone.js";

const dir = "fixtures/wires/systemone";
const wire = systemone({
  provider: "jev",
  url: "https://api.typesafe.ai/v1/systemone",
  apiKey: "test-key",
  headers: { "X-Title": "huncho" },
});

type Fixture = {
  model: string;
  request: EvaluateRequest;
  encoded: unknown;
  response: unknown;
  headers: Record<string, string>;
  decoded: unknown;
};

for (const file of readdirSync(dir).filter((name) => name.endsWith(".json")).sort()) {
  test(`systemone fixture ${file} encodes and decodes exactly`, () => {
    const fixture = JSON.parse(readFileSync(join(dir, file), "utf8")) as Fixture;
    assert.deepEqual(wire.encode(fixture.request, fixture.model), fixture.encoded);
    assert.deepEqual(
      wire.decode(fixture.response, new Headers(fixture.headers), fixture.request),
      fixture.decoded,
    );
  });
}

test("systemone url and headers speak bearer auth at the TypeSafe endpoint", () => {
  assert.equal(wire.url("jev-latest"), "https://api.typesafe.ai/v1/systemone");
  assert.deepEqual(wire.headers("jev-latest"), {
    "X-Title": "huncho",
    Authorization: "Bearer test-key",
  });
});

test("systemone decode rejects a response with no answers", () => {
  assert.throws(
    () => wire.decode({ model: "jev-latest" }, new Headers(), { state: "x", questions: {} }),
    (err: unknown) => {
      assert.equal(err instanceof HunchoError, true);
      const huncho = err as HunchoError;
      assert.equal(huncho.provider, "jev");
      assert.match(huncho.message, /no answers/);
      return true;
    },
  );
});
