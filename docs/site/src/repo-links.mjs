// Repo-relative links in docs/*.md keep working on GitHub and on the site. A link to another
// page under docs/ becomes that page's URL, a link to an example becomes its cookbook page, a
// link to any other file in the repo becomes its GitHub URL, and a link to a file that does not
// exist fails the build.

import { existsSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * @param {{ root: URL, base: string, repo: string }} options
 *   `root` is the repository root, `base` the site's base path and `repo` its GitHub URL.
 */
export function repoLinks({ root, base, repo }) {
  const rootPath = fileURLToPath(root);
  return {
    name: "huncho-repo-links",
    link(node, ctx) {
      if (ctx.fileURL === undefined || !isRepoRelative(node.url)) return;
      const [path, hash = ""] = node.url.split(/(?=#)/);
      const target = resolve(dirname(fileURLToPath(ctx.fileURL)), path);
      if (!existsSync(target)) {
        ctx.report({ message: `link to a file that does not exist: ${node.url}`, node, severity: "error" });
        return;
      }
      const inRepo = relative(rootPath, target).split("\\").join("/");
      const page = pageSlug(inRepo);
      const view = statSync(target).isDirectory() ? "tree" : "blob";
      ctx.setProperty(node, "url", page === undefined ? `${repo}/${view}/main/${inRepo}${hash}` : `${base}/${page}/${hash}`);
    },
  };
}

function isRepoRelative(url) {
  return !/^([a-z][a-z0-9+.-]*:|\/|#)/i.test(url);
}

/** The page a repo path renders as, or undefined for a file that is not a page. */
function pageSlug(inRepo) {
  const doc = /^docs\/(?!site\/)(.+)\.md$/.exec(inRepo);
  if (doc !== null) return doc[1];
  const example = /^examples\/(.+)\.ts$/.exec(inRepo);
  if (example !== null) return `cookbook/${example[1]}`;
  return undefined;
}
