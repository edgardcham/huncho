// Model seam: the one method every layer above calls.
// Transport, wires and providers implement this contract in later tickets.

/** JSON-serialisable value a question can read. */
export type Content =
  | string
  | number
  | boolean
  | null
  | readonly Content[]
  | { readonly [key: string]: Content };

/** State a model evaluates: a string, an object, or an array. */
export type State = string | Record<string, unknown> | readonly unknown[];

/** Probability of yes. */
export interface NoulQuestion {
  readonly type: "noul";
  readonly instructions: Content;
  readonly criteria?: { readonly true?: Content; readonly false?: Content };
}

/** One of a named set. */
export interface ChoiceQuestion<L extends string = string> {
  readonly type: "choice";
  readonly instructions: Content;
  readonly criteria: { readonly [K in L]: Content | null };
}

/** A position on an ordered rubric, lowest level first. */
export interface ScoreQuestion {
  readonly type: "score";
  readonly instructions: Content;
  readonly criteria: readonly Content[];
}

export type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion;
export type Questions = Record<string, Question>;

/**
 * Canonical noul answer. `noul` is in 0..1.
 */
export interface RawNoulAnswer {
  readonly type: "noul";
  readonly noul: number;
}

/**
 * Canonical choice answer. `probabilities` sums to about 1.
 */
export interface RawChoiceAnswer {
  readonly type: "choice";
  readonly choice: string;
  readonly probabilities: Record<string, number>;
  readonly confidence: number;
}

/**
 * Canonical score answer. `probabilities` sums to about 1.
 */
export interface RawScoreAnswer {
  readonly type: "score";
  readonly score: number;
  readonly probabilities: Record<string, number>;
  readonly confidence: number;
  readonly legend?: Record<string, string>;
}

export type RawAnswer = RawNoulAnswer | RawChoiceAnswer | RawScoreAnswer;

export interface Usage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface EvaluateRequest {
  readonly state: State;
  readonly questions: Questions;
  readonly signal?: AbortSignal;
}

export interface EvaluateResult {
  readonly provider: string;
  readonly model: string;
  /**
   * Canonical answers, one per question. Keys are exactly the keys of
   * `EvaluateRequest.questions`.
   */
  readonly answers: Record<string, RawAnswer>;
  readonly usage: Usage;
  /** Wall-clock milliseconds for the call. */
  readonly ms: number;
  readonly requestId?: string;
}

/**
 * A decision model. One method; adapters hide HTTP, auth, retries and dialects.
 *
 * `evaluate` rejects with {@link HunchoError} (`provider`, optional `status`,
 * `requestId`, `body`, `cause`). Never a bare fetch error.
 */
export interface Model {
  readonly provider: string;
  readonly id: string;
  evaluate(req: EvaluateRequest): Promise<EvaluateResult>;
}

/** Failure from a model or the transport behind one. */
export class HunchoError extends Error {
  override readonly name = "HunchoError";
  readonly provider: string;
  readonly status?: number;
  readonly requestId?: string;
  readonly body?: string;

  constructor(
    message: string,
    options: {
      provider: string;
      status?: number;
      requestId?: string;
      body?: string;
      cause?: unknown;
    },
  ) {
    const { provider, status, requestId, body, cause } = options;
    super(message, cause !== undefined ? { cause } : undefined);
    this.provider = provider;
    if (status !== undefined) this.status = status;
    if (requestId !== undefined) this.requestId = requestId;
    if (body !== undefined) this.body = body;
  }
}
