import { AnswerError, ConfigError, HunchoError, PolicyError, ProviderError } from "../src/index.js";

// Compiled, never run: the guards narrow `unknown` with no cast.
export function handle(e: unknown): string {
  if (ConfigError.isInstance(e)) {
    const config: ConfigError = e;
    return config.message;
  }
  if (ProviderError.isInstance(e)) {
    const retryable: boolean = e.retryable;
    const status: number | undefined = e.status;
    return `${e.provider} ${String(retryable)} ${String(status)}`;
  }
  if (PolicyError.isInstance(e) || AnswerError.isInstance(e)) {
    const base: HunchoError = e;
    return base.name;
  }
  if (HunchoError.isInstance(e)) {
    // @ts-expect-error — retryable lives on ProviderError, not on the base
    return String(e.retryable);
  }
  // @ts-expect-error — outside every guard, e is still unknown
  return e.message;
}

export function construct(): HunchoError[] {
  return [
    new HunchoError("x"),
    new ConfigError("x", { cause: new Error("why") }),
    new PolicyError("x"),
    new AnswerError("x"),
    new ProviderError("x", { provider: "p", retryable: false }),
    // @ts-expect-error — retryable is required on a ProviderError
    new ProviderError("x", { provider: "p" }),
    // @ts-expect-error — the base no longer carries provider fields
    new HunchoError("x", { provider: "p" }),
  ];
}
