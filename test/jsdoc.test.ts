import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import ts from "typescript";

// Every `@example` under src/ is pulled into its own module under dist/doc-examples and
// type-checked with the repo's compiler options against the built declarations, imported by
// package name the way a caller imports them. Nothing is executed.

const SRC = "src";
const OUT = join("dist", "doc-examples");

/** Symbols the hover docs must teach with an example. */
const REQUIRED = ["huncho", "noul", "Huncho.when", "replay", "calibrate"];

type Example = {
  /** Dotted path of the documented declaration, `Huncho.when` for a method. */
  readonly symbol: string;
  /** `file:line` of the tag, for a failing example's message. */
  readonly at: string;
  /** The tag body as written, fence included. */
  readonly text: string;
};

function examples(): Example[] {
  const found: Example[] = [];
  for (const name of readdirSync(SRC).filter((f) => f.endsWith(".ts")).sort()) {
    const path = join(SRC, name);
    const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      for (const tag of named(node) ? ts.getJSDocTags(node) : []) {
        if (tag.tagName.text !== "example") continue;
        const at = `${path}:${source.getLineAndCharacterOfPosition(tag.pos).line + 1}`;
        found.push({ symbol: symbolOf(node), at, text: ts.getTextOfJSDocComment(tag.comment) ?? "" });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return found;
}

/**
 * The declarations JSDoc attaches to. A `const` reports the statement's comment
 * from the declaration inside it, so the statement and its list are not counted.
 */
function named(node: ts.Node): node is ts.NamedDeclaration {
  return ts.isDeclarationStatement(node) || ts.isVariableDeclaration(node) || ts.isClassElement(node) || ts.isTypeElement(node);
}

/** Names from the outermost declaration down, so an overload of `when` on `Huncho` is `Huncho.when`. */
function symbolOf(node: ts.Node): string {
  const parts: string[] = [];
  for (let n: ts.Node | undefined = node; n !== undefined; n = n.parent) {
    if (!named(n)) continue;
    const name = ts.getNameOfDeclaration(n);
    if (name !== undefined && ts.isIdentifier(name)) parts.unshift(name.text);
  }
  return parts.join(".");
}

const FENCE = /^```ts\n([\s\S]*?)\n```$/;

function code(example: Example): string {
  const match = FENCE.exec(example.text.trim());
  assert.ok(match?.[1] !== undefined, `${example.at}: @example on ${example.symbol} is not a single \`\`\`ts block`);
  return match[1];
}

const all = examples();

test("there are examples to compile", () => {
  assert.ok(all.length > 0);
});

for (const symbol of REQUIRED) {
  test(`${symbol} has an example`, () => {
    assert.ok(
      all.some((example) => example.symbol === symbol),
      `no @example on ${symbol}; found ${[...new Set(all.map((e) => e.symbol))].join(", ")}`,
    );
  });
}

test("every example is a fenced ts block", () => {
  for (const example of all) code(example);
});

test("every example compiles against the built declarations", () => {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const files = all.map((example, i) => {
    const file = join(OUT, `${basename(example.at.split(":")[0] ?? "", ".ts")}.${example.symbol}.${i}.ts`);
    // `export {}` makes each file a module, so two examples may both declare `route`.
    writeFileSync(file, `// ${example.at}\n${code(example)}\nexport {};\n`);
    return file;
  });

  const config = ts.readConfigFile("tsconfig.json", ts.sys.readFile);
  assert.equal(config.error, undefined);
  const { options } = ts.parseJsonConfigFileContent(config.config, ts.sys, ".");
  const program = ts.createProgram(files, { ...options, noEmit: true, declaration: false, sourceMap: false });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  const host: ts.FormatDiagnosticsHost = {
    getCanonicalFileName: (f) => f,
    getCurrentDirectory: () => process.cwd(),
    getNewLine: () => "\n",
  };
  assert.equal(diagnostics.length, 0, `\n${ts.formatDiagnostics(diagnostics, host)}`);
});
