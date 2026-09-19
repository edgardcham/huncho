import { test } from "node:test";
import assert from "node:assert/strict";
import { shape } from "../src/index.js";

test("pick keeps only the named keys", () => {
  assert.deepEqual(shape({ subject: "invoice", secret: "card", extra: true }).pick("subject").build(), {
    subject: "invoice",
  });
});

test("omit drops the named keys", () => {
  assert.deepEqual(shape({ subject: "invoice", secret: "card" }).omit("secret").build(), {
    subject: "invoice",
  });
});

test("rename remaps keys and leaves the rest", () => {
  assert.deepEqual(shape({ subject: "invoice", body: "overdue" }).rename({ subject: "title" }).build(), {
    title: "invoice",
    body: "overdue",
  });
});

test("redact replaces values and the original never appears in the built object", () => {
  const secret = "card-number-4242";
  const built = shape({ subject: "invoice", secret }).redact("secret").build();
  assert.deepEqual(built, { subject: "invoice", secret: "[redacted]" });
  assert.equal(JSON.stringify(built).includes(secret), false);
});

test("truncate keeps head and tail with an omitted-count marker", () => {
  assert.equal(shape({ body: "abcdefghij" }).truncate("body", 6).build().body, "abc[...4 omitted...]hij");
  assert.equal(shape({ body: "short" }).truncate("body", 6).build().body, "short");
  assert.equal(shape({ count: 12 }).truncate("count", 1).build().count, 12);
});

test("add inserts a key and overwrites an existing one", () => {
  assert.deepEqual(shape({ subject: "invoice" }).add("source", "mail").build(), {
    subject: "invoice",
    source: "mail",
  });
  assert.deepEqual(shape({ subject: "invoice" }).add("subject", 123).build(), { subject: 123 });
});

test("pick and rename keep an own __proto__ key", () => {
  const input = JSON.parse('{"subject":"invoice","__proto__":{"kind":"own"}}') as {
    subject: string;
    __proto__: { kind: string };
  };
  const picked = shape(input).pick("__proto__", "subject").build();
  assert.equal(picked.subject, "invoice");
  assert.deepEqual(Object.getOwnPropertyDescriptor(picked, "__proto__")?.value, { kind: "own" });
  assert.equal(Object.getPrototypeOf(picked), Object.prototype);

  const renamed = shape({ secret: "card" }).rename({ secret: "__proto__" }).build();
  assert.equal(Object.getOwnPropertyDescriptor(renamed, "__proto__")?.value, "card");
  assert.equal(Object.getPrototypeOf(renamed), Object.prototype);
});

test("operations chain and do not mutate the input", () => {
  const input = {
    id: "t1",
    subject: "invoice",
    body: "abcdefghij",
    secret: "card-number-4242",
    extra: true,
  };
  const built = shape(input)
    .pick("subject", "body", "secret", "extra")
    .omit("extra")
    .rename({ subject: "title" })
    .redact("secret")
    .truncate("body", 6)
    .add("source", "mail")
    .build();

  assert.deepEqual(built, {
    title: "invoice",
    body: "abc[...4 omitted...]hij",
    secret: "[redacted]",
    source: "mail",
  });
  assert.deepEqual(input, {
    id: "t1",
    subject: "invoice",
    body: "abcdefghij",
    secret: "card-number-4242",
    extra: true,
  });
  assert.equal(JSON.stringify(built).includes("card-number-4242"), false);
});
