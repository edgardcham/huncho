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

/**
 * Base of every error huncho throws. Catch this to catch them all; the subclass
 * says which layer failed and the message names the fix.
 *
 * @example
 * ```ts
 * import { HunchoError, huncho, noul } from "huncho";
 * import { jev } from "huncho/jev";
 *
 * const route = huncho("support.route", { model: jev() })
 *   .ask({ urgent: noul("Does this need a human within the hour?") })
 *   .else("triage");
 *
 * try {
 *   await route.decide("Checkout is down.");
 * } catch (e) {
 *   if (!HunchoError.isInstance(e)) throw e;
 *   console.error(`${e.name}: ${e.message}`);
 * }
 * ```
 */
export class HunchoError extends Error {
  /** The class name, as the first line of a stack trace prints it. */
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

/**
 * Something in how huncho was set up: a missing key, an impossible threshold, a
 * builder called out of order. Thrown when the mistake is made, not later. The
 * message names the fix.
 *
 * @example
 * ```ts
 * import { ConfigError, score } from "huncho";
 *
 * try {
 *   score("How complete is the answer?", ["Only one level"]);
 * } catch (e) {
 *   if (!ConfigError.isInstance(e)) throw e;
 *   e.message; // "score() needs at least two levels, see …"
 * }
 * ```
 */
export class ConfigError extends HunchoError {
  /** The class name, as the first line of a stack trace prints it. */
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
 *
 * @example
 * ```ts
 * import { ProviderError, ask, noul } from "huncho";
 * import { jev } from "huncho/jev";
 *
 * try {
 *   await ask(jev(), "Checkout is down.", { urgent: noul("Does this need a human within the hour?") });
 * } catch (e) {
 *   if (!ProviderError.isInstance(e)) throw e;
 *   e.retryable; // true after 429, 503 or a network failure; false after 401 or 422
 *   e.status;    // 429
 * }
 * ```
 */
export class ProviderError extends HunchoError {
  /** The class name, as the first line of a stack trace prints it. */
  override readonly name = "ProviderError";
  /** Name of the provider that failed, as in `Model.provider`. */
  readonly provider: string;
  /** HTTP status of the last attempt, when there was a response. */
  declare readonly status?: number;
  /** The vendor's request id, when the response carried one. */
  declare readonly requestId?: string;
  /** First 300 characters of what the provider sent back. */
  declare readonly body?: string;
  /** True when the same request may succeed later: a retryable status, or a network failure once retries were spent. */
  readonly retryable: boolean;

  /**
   * @param message What failed and what to do about it.
   * @param options `provider` and `retryable` are required; `cause` is the underlying error, when there is one.
   */
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

/**
 * No clause matched and the policy has no `else`. The message names the huncho.
 * Add an `else` to make every decision total.
 *
 * @example
 * ```ts
 * import { PolicyError, policy } from "huncho";
 *
 * const gate = policy<{ p: number }>("gate").when((a) => a.p, { enter: 0.8 }, "open");
 *
 * try {
 *   gate.decide({ p: 0.2 });
 * } catch (e) {
 *   if (!PolicyError.isInstance(e)) throw e;
 *   e.message; // 'policy "gate": no clause matched and there is no else, see …'
 * }
 * ```
 */
export class PolicyError extends HunchoError {
  /** The class name, as the first line of a stack trace prints it. */
  override readonly name = "PolicyError";

  override get [brand](): string {
    return "PolicyError";
  }

  static override isInstance(e: unknown): e is PolicyError {
    return kindOf(e) === "PolicyError";
  }
}

/**
 * A question the huncho asks has no answer, or an answer of the wrong shape.
 * The message names the question. Seen when a journal was written by different
 * questions than the ones replayed, or a custom provider drops an id.
 *
 * @example
 * ```ts
 * import { AnswerError, noul, wrapAnswers } from "huncho";
 *
 * try {
 *   wrapAnswers({}, { urgent: noul("Does this need a human within the hour?") });
 * } catch (e) {
 *   if (!AnswerError.isInstance(e)) throw e;
 *   e.message; // 'no answer for question "urgent", see …'
 * }
 * ```
 */
export class AnswerError extends HunchoError {
  /** The class name, as the first line of a stack trace prints it. */
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
