// huncho/testing: a scripted Model so callers exercise decisions without a network.

import { createProvider } from "./provider.js";
import { ConfigError, see } from "./errors.js";
import type { EvaluateRequest, Model, RawAnswer } from "./types.js";

/**
 * A model that answers from a script instead of a network. Call `n` returns
 * `script[n]`; past the end, the last entry repeats. Every request is
 * recorded, so a test can assert what a huncho asked. The model reports
 * `provider` and `model` as `"scripted"`, zero usage and `ms: 0`.
 *
 * @param script One entry per call, each the canonical answers keyed by question id.
 * @throws `ConfigError` when the script is empty.
 * @example
 * ```ts
 * import { huncho, noul } from "huncho";
 * import { scriptedModel } from "huncho/testing";
 *
 * const { model, requests } = scriptedModel([
 *   { answers: { urgent: { type: "noul", noul: 0.91 } } },
 *   { answers: { urgent: { type: "noul", noul: 0.7 } } },
 * ]);
 * const route = huncho("support.route", { model })
 *   .ask({ urgent: noul("Does this need a human within the hour?") })
 *   .when((a) => a.urgent.p, { enter: 0.8, exit: 0.6 }, "page")
 *   .else("wait");
 *
 * (await route.decide("first", { key: "T-1" })).outcome;  // "page"
 * (await route.decide("second", { key: "T-1" })).outcome; // "page": held through the dip
 * requests.length; // 2
 * ```
 */
export function scriptedModel(
  script: readonly { readonly answers: Record<string, RawAnswer> }[],
): {
  /** The scripted model. Pass it as `model` to `huncho()` or `ask()`. */
  model: Model;
  /** Every request the model received, in order. The live array. */
  requests: EvaluateRequest[];
} {
  if (script.length === 0) throw emptyScript();

  const requests: EvaluateRequest[] = [];
  let index = 0;
  const provider = createProvider({
    name: "scripted",
    defaultModel: "scripted",
    evaluate: async ({ state, questions, signal }) => {
      const request: EvaluateRequest = {
        state,
        questions,
        ...(signal !== undefined ? { signal } : {}),
      };
      requests.push(request);
      const entry = scriptEntry(script, index);
      index += 1;
      return { answers: entry.answers };
    },
  });

  return { model: provider(), requests };
}

function scriptEntry(
  script: readonly { readonly answers: Record<string, RawAnswer> }[],
  index: number,
): { readonly answers: Record<string, RawAnswer> } {
  const entry = script[Math.min(index, script.length - 1)];
  if (entry === undefined) throw emptyScript();
  return entry;
}

function emptyScript(): ConfigError {
  return new ConfigError(
    `scriptedModel: the script needs at least one entry, ${see("docs/providers.md#scripted-model-for-tests")}`,
  );
}
