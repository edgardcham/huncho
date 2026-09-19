import { register } from "node:module";
import { parentPort } from "node:worker_threads";

register(
  `data:text/javascript,${encodeURIComponent(`
    export async function resolve(specifier, context, nextResolve) {
      if (specifier.startsWith("node:")) {
        throw new Error("node: modules are not available");
      }
      return nextResolve(specifier, context);
    }
  `)}`,
);

try {
  const huncho = await import("huncho");
  parentPort?.postMessage({ ok: true, version: typeof huncho.VERSION === "string" });
} catch (err) {
  parentPort?.postMessage({ ok: false, error: String(err) });
}
