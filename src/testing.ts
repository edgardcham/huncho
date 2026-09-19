// huncho/testing: a scripted Model so callers exercise decisions without a network.

import { createProvider } from "./provider.js";
import { HunchoError } from "./types.js";
import type { EvaluateRequest, Model, RawAnswer } from "./types.js";

export function scriptedModel(
  script: readonly { readonly answers: Record<string, RawAnswer> }[],
): { model: Model; requests: EvaluateRequest[] } {
  if (script.length === 0) {
    throw new HunchoError("scriptedModel: script must have at least one entry", { provider: "scripted" });
  }

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
  if (entry === undefined) {
    throw new HunchoError("scriptedModel: script must have at least one entry", { provider: "scripted" });
  }
  return entry;
}
