import { createGateway } from "huncho/gateway";
import { createJev } from "huncho/jev";
import { createOpenRouter } from "huncho/openrouter";

// Compiled, never run: `process.env.X` is `string | undefined`, and with
// `exactOptionalPropertyTypes` on every factory accepts it as the README writes it.
export function keysFromTheEnvironment() {
  return [
    createJev({ apiKey: process.env.SOME_KEY }),
    createOpenRouter({ apiKey: process.env.SOME_KEY }),
    createGateway({ apiKey: process.env.SOME_KEY }),
  ];
}
