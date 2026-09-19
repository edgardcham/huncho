// The site reads the repo: pages come from ../*.md, the cookbook embeds ../../examples/*.ts
// and the API reference is generated from ../../src by typedoc at build time. Nothing here is
// a second copy of anything.

import { readFileSync } from "node:fs";
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import { satteri } from "@astrojs/markdown-satteri";
import starlightLinksValidator from "starlight-links-validator";
import starlightTypeDoc, { typeDocSidebarGroup } from "starlight-typedoc";
import { repoLinks } from "./src/repo-links.mjs";

const repo = "https://github.com/edgardcham/huncho";
const base = "/huncho";

// The typedoc.json `npm run docs` runs at the root: the same entry points and the same
// strictness. Only its HTML output path is dropped; here typedoc writes markdown pages.
const { $schema, out, entryPoints, ...typeDoc } = JSON.parse(readFileSync(new URL("../../typedoc.json", import.meta.url), "utf8"));

export default defineConfig({
  site: "https://edgardcham.github.io",
  base,
  markdown: {
    processor: satteri({ mdastPlugins: [repoLinks({ root: new URL("../../", import.meta.url), base, repo })] }),
  },
  integrations: [
    starlight({
      title: "huncho",
      description: "Decisions as code: typed questions, thresholds with hysteresis, nested decisions, a journal, replay and calibration over decision models.",
      social: [{ icon: "github", label: "GitHub", href: repo }],
      // Entries from ../ carry a `../` in their path; the URL parser folds it into docs/.
      editLink: { baseUrl: `${repo}/edit/main/docs/site/` },
      markdown: { processedDirs: ["../"] },
      sidebar: [
        { label: "Getting started", slug: "getting-started" },
        {
          label: "Concepts",
          items: [
            { label: "Questions and answers", slug: "questions" },
            { label: "Policy and hysteresis", slug: "policy" },
            { label: "Journal and replay", slug: "journal" },
            { label: "Calibration", slug: "calibration" },
            { label: "Nested decisions", slug: "nested" },
            { label: "Observability", slug: "observability" },
          ],
        },
        {
          label: "Providers",
          items: [
            { label: "Overview", slug: "providers" },
            { label: "TypeSafe Jev", slug: "providers/jev" },
            { label: "OpenRouter", slug: "providers/openrouter" },
            { label: "Vercel AI Gateway", slug: "providers/gateway" },
            { label: "Adding a vendor", slug: "providers/adding-a-vendor" },
          ],
        },
        { label: "Cookbook", items: [{ autogenerate: { directory: "cookbook" } }] },
        typeDocSidebarGroup,
        {
          label: "Reference",
          items: [
            { label: "Wire fixtures", slug: "wires" },
            { label: "Stability", slug: "stability" },
          ],
        },
      ],
      plugins: [
        starlightTypeDoc({
          entryPoints: entryPoints.map((path) => `../../${path}`),
          tsconfig: "../../tsconfig.json",
          // Module index pages are kept as `index.md`; the plugin drops `README.md` ones.
          typeDoc: { ...typeDoc, entryFileName: "index" },
          sidebar: { label: "API reference", collapsed: true },
        }),
        starlightLinksValidator(),
      ],
    }),
  ],
});
