import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readdirSync } from "node:fs";
import { basename } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const apiKey = process.env.TYPESAFE_API_KEY;

const examples = readdirSync("examples")
  .filter((name) => name.endsWith(".ts"))
  .map((name) => basename(name, ".ts"))
  .sort();

test("there are examples to run", () => {
  assert.ok(examples.length > 0);
});

for (const name of examples) {
  test(`example ${name} runs with only TYPESAFE_API_KEY set`, { skip: apiKey === undefined }, async () => {
    const { stdout } = await run(process.execPath, [`dist/examples/${name}.js`], {
      env: { TYPESAFE_API_KEY: apiKey },
      timeout: 60_000,
    });
    assert.ok(stdout.trim().length > 0, `${name} printed nothing`);
  });
}
