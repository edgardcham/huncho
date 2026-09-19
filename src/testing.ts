// huncho/testing: a scripted Model so callers exercise decisions without a network.

import { createProvider } from "./provider.js";
import { ConfigError, see } from "./errors.js";
import type { EvaluateRequest, Model, RawAnswer } from "./types.js";

export function scriptedModel(
  script: readonly { readonly answers: Record<string, RawAnswer> }[],
): { model: Model; requests: EvaluateRequest[] } {
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
