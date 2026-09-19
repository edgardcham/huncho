import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import ts from "typescript";

// Every public export, as package.json's `exports` define them, must carry an `@example`.
// Every `@example` under src/ is pulled into its own module under dist/doc-examples and
// type-checked with the repo's compiler options against the built declarations, imported by
// package name the way a caller imports them. Nothing is executed.

const SRC = "src";
const OUT = join("dist", "doc-examples");

/** Methods the hover docs must teach with an example of their own, beyond the exports. */
const METHODS = ["Huncho.when"];

type Example = {
  /** Source file the example was written in. */
  readonly file: string;
  /** Dotted path of the documented declaration, `Huncho.when` for a method. */
  readonly symbol: string;
  /** `file:line` of the tag, for a failing example's message. */
  readonly at: string;
  /** The tag body as written, fence included. */
  readonly text: string;
};

type Export = {
  /** Source file the declaration lives in, re-exports followed one level. */
  readonly file: string;
  /** The declaration's own name. */
  readonly symbol: string;
  /** The entry and name a caller imports it by. */
  readonly as: string;
};

/** Every name each entry exports, from the source file the entry says it comes from. */
function exports(): Export[] {
  const manifest = JSON.parse(readFileSync("package.json", "utf8")) as {
    exports: Record<string, { types: string }>;
  };
  const found: Export[] = [];
  for (const [subpath, target] of Object.entries(manifest.exports)) {
    const entry = target.types.replace(/^\.\/dist\//, "").replace(/\.d\.ts$/, ".ts");
    const source = ts.createSourceFile(entry, readFileSync(entry, "utf8"), ts.ScriptTarget.Latest, true);
    const as = (name: string) => `${subpath === "." ? "huncho" : `huncho/${subpath.slice(2)}`}: ${name}`;
    for (const statement of source.statements) {
      if (ts.isExportDeclaration(statement)) {
        assert.ok(statement.exportClause !== undefined && ts.isNamedExports(statement.exportClause), `${entry}: export * is not followed`);
        const from = statement.moduleSpecifier;
        const file =
          from === undefined || !ts.isStringLiteral(from)
            ? entry
            : join(SRC, from.text.replace(/^\.\//, "").replace(/\.js$/, ".ts"));
        for (const element of statement.exportClause.elements) {
          const symbol = element.propertyName?.text ?? element.name.text;
          found.push({ file, symbol, as: as(element.name.text) });
        }
        continue;
      }
      if (!ts.canHaveModifiers(statement) || !ts.getModifiers(statement)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
        continue;
      }
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name)) found.push({ file: entry, symbol: declaration.name.text, as: as(declaration.name.text) });
        }
        continue;
      }
      const name = ts.getNameOfDeclaration(statement as ts.Declaration);
      if (name !== undefined && ts.isIdentifier(name)) found.push({ file: entry, symbol: name.text, as: as(name.text) });
    }
  }
  return found;
}

function examples(): Example[] {
  const found: Example[] = [];
  for (const name of readdirSync(SRC).filter((f) => f.endsWith(".ts")).sort()) {
    const path = join(SRC, name);
    const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      for (const tag of named(node) ? ts.getJSDocTags(node) : []) {
        if (tag.tagName.text !== "example") continue;
        const at = `${path}:${source.getLineAndCharacterOfPosition(tag.pos).line + 1}`;
        found.push({ file: path, symbol: symbolOf(node), at, text: ts.getTextOfJSDocComment(tag.comment) ?? "" });
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
const surface = exports();

test("the public surface is not empty", () => {
  assert.ok(surface.length > 0);
});

for (const item of surface) {
  test(`${item.as} has an example`, () => {
    assert.ok(
      all.some((example) => example.file === item.file && example.symbol === item.symbol),
      `no @example on ${item.symbol} in ${item.file}`,
    );
  });
}

for (const symbol of METHODS) {
  test(`${symbol} has an example`, () => {
    assert.ok(all.some((example) => example.symbol === symbol), `no @example on ${symbol}`);
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
