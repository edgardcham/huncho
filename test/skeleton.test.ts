import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { VERSION } from "../src/index.js";

test("the package loads", () => {
  assert.equal(typeof VERSION, "string");
});

test("VERSION is the version package.json publishes", () => {
  const { version } = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
  assert.equal(VERSION, version);
});
