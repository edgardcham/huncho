// A Provider is a callable factory: provider() or provider(id) returns a Model.

import type { Model } from "./types.js";

export interface Provider {
  (id?: string): Model;
  readonly name: string;
  readonly defaultModel: string;
}

export function makeProvider(name: string, defaultModel: string, model: (id: string) => Model): Provider {
  const call = (id?: string): Model => model(id ?? defaultModel);
  Object.defineProperty(call, "name", { value: name });
  Object.defineProperty(call, "defaultModel", { value: defaultModel });
  return call as Provider;
}
