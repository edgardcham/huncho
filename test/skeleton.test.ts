import { test } from "node:test";
import assert from "node:assert/strict";
import { VERSION } from "../src/index.js";

test("the package loads", () => {
  assert.equal(typeof VERSION, "string");
});
