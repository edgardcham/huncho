import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { docsSchema } from "@astrojs/starlight/schema";
import { slug } from "github-slugger";

// One collection, two sources: the markdown under the repo's docs/ and the pages that only make
// sense on the site (the home page, the cookbook, the generated API reference). Both are read
// from the repo root so a repo page's id is its path under docs/, as its links assume.
const sources = ["docs/site/src/content/docs/", "docs/"];

export const collections = {
  docs: defineCollection({
    loader: glob({
      base: "../..",
      pattern: ["docs/*.md", "docs/providers/*.md", "docs/site/src/content/docs/**/[^_]*.{md,mdx}"],
      generateId: ({ entry, data }) => {
        if (typeof data.slug === "string") return data.slug;
        const source = sources.find((prefix) => entry.startsWith(prefix)) ?? "";
        return entry
          .slice(source.length)
          .replace(/\.mdx?$/, "")
          .split("/")
          .map((segment) => slug(segment))
          .join("/")
          .replace(/\/index$/, "");
      },
    }),
    schema: docsSchema(),
  }),
};
