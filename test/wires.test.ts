import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { EvaluateRequest } from "../src/index.js";
import { gateway } from "../src/gateway.js";
import { systemone } from "../src/systemone.js";
import type { Wire } from "../src/wire.js";

const root = "fixtures/wires";

const wires: Record<string, Wire> = {
  systemone: systemone({
    provider: "jev",
    url: "https://api.typesafe.ai/v1/systemone",
    apiKey: "test-key",
  }),
  gateway: gateway({
    provider: "gateway",
    url: "https://ai-gateway.vercel.sh/v4/ai/evaluation-model",
    apiKey: "test-key",
  }),
  openrouter: systemone({
    provider: "openrouter",
    url: "https://openrouter.ai/api/alpha/decisions",
    apiKey: "test-key",
    headers: {
      "HTTP-Referer": "https://example.test",
      "X-Title": "huncho",
    },
  }),
};

type Fixture = {
  model: string;
  request: EvaluateRequest;
  expect: { url: string; headers: Record<string, string>; body: unknown };
  response: { status: number; headers: Record<string, string>; json: unknown };
  decoded: unknown;
};

test("every wire has a fixture directory", () => {
  const adapters = exportedWireAdapters("src");
  assert.ok(adapters.length > 0, "src exports no Wire factory");
  const names = new Set([...adapters, ...Object.keys(wires)]);
  for (const name of [...names].sort()) {
    const dir = join(root, name);
    assert.equal(existsSync(dir) && statSync(dir).isDirectory(), true, `${name} has no fixture directory`);
    assert.ok(jsonFiles(dir).length > 0, `${name} fixture directory is empty`);
    if (adapters.includes(name)) {
      assert.ok(name in wires, `${name} exports a Wire and must be in the runner`);
    }
  }
});

for (const name of fixtureDirectories(root)) {
  const wire = wires[name];
  test(`${name} is a registered wire`, () => {
    assert.ok(wire, `${name} has no runner`);
  });
  if (wire === undefined) continue;

  for (const file of jsonFiles(join(root, name))) {
    test(`${name} fixture ${file} encodes and decodes exactly`, () => {
      const fixture = readFixture(join(root, name, file));
      assert.equal(wire.url(fixture.model), fixture.expect.url);
      assert.deepEqual(wire.headers(fixture.model), fixture.expect.headers);
      assert.deepEqual(wire.encode(fixture.request, fixture.model), fixture.expect.body);
      assert.deepEqual(
        wire.decode(fixture.response.json, new Headers(fixture.response.headers), fixture.request),
        fixture.decoded,
      );
    });
  }
}

function fixtureDirectories(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => statSync(join(dir, name)).isDirectory())
    .sort();
}

function jsonFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort();
}

function readFixture(path: string): Fixture {
  const fixture = JSON.parse(readFileSync(path, "utf8")) as Fixture;
  assert.equal(typeof fixture.model, "string", `${path} model`);
  assert.ok(isRecord(fixture.request), `${path} request`);
  assert.ok(isRecord(fixture.expect), `${path} expect`);
  assert.equal(typeof fixture.expect.url, "string", `${path} expect.url`);
  assert.ok(isRecord(fixture.expect.headers), `${path} expect.headers`);
  assert.ok(isRecord(fixture.response), `${path} response`);
  assert.equal(typeof fixture.response.status, "number", `${path} response.status`);
  assert.ok(isRecord(fixture.response.headers), `${path} response.headers`);
  assert.ok(isRecord(fixture.decoded), `${path} decoded`);
  return fixture;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exportedWireAdapters(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".ts"))
    .sort()
    .filter((name) => exportsWire(readFileSync(join(dir, name), "utf8")))
    .map((name) => basename(name, ".ts"));
}

function exportsWire(text: string): boolean {
  for (const match of text.matchAll(/^export function \w+\(/gm)) {
    const end = closeParen(text, match.index + match[0].length);
    if (end !== undefined && /^\s*:\s*Wire\b/.test(text.slice(end))) return true;
  }
  return false;
}

function closeParen(text: string, start: number): number | undefined {
  let depth = 1;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return undefined;
}
