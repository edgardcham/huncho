// Errors: one base, four layers. Which layer failed and whether a retry can help
// are read from the class, never parsed out of the message.

/**
 * Registered symbol, so two copies of this module (two bundles, two package
 * versions in one tree) brand their instances identically. `instanceof` compares
 * class identity and fails across copies; `isInstance` reads the brand instead.
 */
const brand: unique symbol = Symbol.for("huncho.error");

const DOCS = "https://github.com/edgardcham/huncho/blob/main/";

/** The docs pointer every huncho message ends with. `path` is repo-relative, anchor included. */
export function see(path: string): string {
  return `see ${DOCS}${path}`;
}

/** Base of every error huncho throws. Catch this to catch them all. */
export class HunchoError extends Error {
  override readonly name: string = "HunchoError";

  /** Read by `isInstance`. On the prototype, so instances carry no extra own property. */
  get [brand](): string {
    return "HunchoError";
  }

  /** True for every huncho error, whichever copy of the package threw it. */
  static isInstance(e: unknown): e is HunchoError {
    return kindOf(e) !== undefined;
  }
}

/** Something in how huncho was set up: a missing key, an impossible threshold, a builder called out of order. The message names the fix. */
export class ConfigError extends HunchoError {
  override readonly name = "ConfigError";

  override get [brand](): string {
    return "ConfigError";
  }

  static override isInstance(e: unknown): e is ConfigError {
    return kindOf(e) === "ConfigError";
  }
}

/**
 * A model failed to answer: a non-2xx status, a network failure once retries are
 * spent, or a 2xx body that does not decode. `retryable` says whether the same
 * request may succeed later; the status set behind that verdict lives in transport.
 */
export class ProviderError extends HunchoError {
  override readonly name = "ProviderError";
  readonly provider: string;
  declare readonly status?: number;
  declare readonly requestId?: string;
  /** First 300 characters of what the provider sent back. */
  declare readonly body?: string;
  readonly retryable: boolean;

  constructor(
    message: string,
    options: {
      provider: string;
      status?: number;
      requestId?: string;
      body?: string;
      retryable: boolean;
      cause?: unknown;
    },
  ) {
    const { provider, status, requestId, body, retryable, cause } = options;
    super(message, cause !== undefined ? { cause } : undefined);
    this.provider = provider;
    if (status !== undefined) this.status = status;
    if (requestId !== undefined) this.requestId = requestId;
    if (body !== undefined) this.body = body;
    this.retryable = retryable;
  }

  override get [brand](): string {
    return "ProviderError";
  }

  static override isInstance(e: unknown): e is ProviderError {
    return kindOf(e) === "ProviderError";
  }
}

/** No clause matched and the policy has no `else`. The message names the huncho. */
export class PolicyError extends HunchoError {
  override readonly name = "PolicyError";

  override get [brand](): string {
    return "PolicyError";
  }

  static override isInstance(e: unknown): e is PolicyError {
    return kindOf(e) === "PolicyError";
  }
}

/** A question the huncho asks has no answer, or an answer of the wrong shape. The message names the question. */
export class AnswerError extends HunchoError {
  override readonly name = "AnswerError";

  override get [brand](): string {
    return "AnswerError";
  }

  static override isInstance(e: unknown): e is AnswerError {
    return kindOf(e) === "AnswerError";
  }
}

function kindOf(e: unknown): string | undefined {
  if (typeof e !== "object" || e === null || !(brand in e)) return undefined;
  const kind: unknown = (e as { [brand]: unknown })[brand];
  return typeof kind === "string" ? kind : undefined;
}
