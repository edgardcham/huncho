// Loads the given package specifiers where node: modules cannot be resolved, and reports the first failure.
import { register } from "node:module";
import { parentPort, workerData } from "node:worker_threads";

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

const specifiers = workerData as string[];
try {
  for (const specifier of specifiers) await import(specifier);
  parentPort?.postMessage({ ok: true });
} catch (err) {
  parentPort?.postMessage({ ok: false, error: String(err) });
}
