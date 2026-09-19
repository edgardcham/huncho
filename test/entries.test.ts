import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { promisify } from "node:util";
import { Worker } from "node:worker_threads";

const run = promisify(execFile);

/** Runtime exports of every entry, by subpath. Types are not listed; they do not exist at runtime. */
const documented: Record<string, readonly string[]> = {
  ".": [
    "VERSION",
    "HunchoError",
    "createProvider",
    "createJev",
    "jev",
    "createOpenRouter",
    "openrouter",
    "createGateway",
    "gateway",
    "ask",
    "noul",
    "choice",
    "score",
    "wrapAnswers",
    "policy",
    "all",
    "any",
    "weighted",
    "uncertain",
    "violation",
    "memoryJournal",
    "fileJournal",
    "readJournal",
    "stableStringify",
    "sha256",
    "huncho",
    "replay",
    "calibrate",
    "shape",
  ],
  "./jev": ["createJev", "jev"],
  "./openrouter": ["createOpenRouter", "openrouter"],
  "./gateway": ["createGateway", "gateway"],
  "./node": ["fileJournal", "readJournal"],
  "./testing": ["scriptedModel"],
};

const manifest = JSON.parse(readFileSync("package.json", "utf8")) as {
  exports: Record<string, Record<string, string>>;
};
const subpaths = Object.keys(manifest.exports);

function specifier(subpath: string): string {
  return `huncho${subpath.slice(1)}`;
}

test("the exports map lists exactly the documented entries, types first", () => {
  assert.deepEqual([...subpaths].sort(), Object.keys(documented).sort());
  for (const subpath of subpaths) {
    const entry = manifest.exports[subpath] ?? {};
    assert.deepEqual(Object.keys(entry), ["types", "import"], subpath);
    for (const target of Object.values(entry)) assert.ok(existsSync(target), `${subpath}: ${target}`);
  }
});

for (const subpath of subpaths) {
  test(`${specifier(subpath)} resolves and exports exactly its documented names`, async () => {
    const entry = (await import(specifier(subpath))) as Record<string, unknown>;
    assert.deepEqual(Object.keys(entry).sort(), [...(documented[subpath] ?? [])].sort());
  });
}

test("every entry but huncho/node loads where node: modules cannot be resolved", async () => {
  const worker = new Worker(new URL("./edge-worker.js", import.meta.url), {
    workerData: subpaths.filter((subpath) => subpath !== "./node").map(specifier),
  });
  const result = await new Promise<{ ok: boolean; error?: string }>((resolve, reject) => {
    worker.once("message", resolve);
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (code !== 0) reject(new Error(`worker exited ${code}`));
    });
  });
  await worker.terminate();
  assert.equal(result.ok, true, result.error);
});

test("npm pack ships only dist/src, README and LICENSE", async () => {
  const { stdout } = await run("npm", ["pack", "--dry-run", "--json"]);
  const [packed] = JSON.parse(stdout) as [{ files: { path: string }[] }];
  const paths = (packed?.files ?? []).map((file) => file.path).sort();
  const fixed = ["LICENSE", "README.md", "package.json"];
  for (const name of fixed) assert.ok(paths.includes(name), `${name} is not packed`);
  const stray = paths.filter((path) => !fixed.includes(path) && !path.startsWith("dist/src/"));
  assert.deepEqual(stray, []);
  assert.ok(paths.some((path) => path.startsWith("dist/src/")), "dist/src is not packed");
});
