// Huncho: shape → model → policy → branches → journal. Per-key hysteresis stays inside.

import { ask } from "./ask.js";
import { sha256, stableStringify, type Journal } from "./journal.js";
import { policy, type Policy } from "./policy.js";
import { wrapAnswers, type Answers } from "./questions.js";
import type { EvaluateResult, Model, Question, Questions, RawAnswer, State, Usage } from "./types.js";

export interface Decision<Q extends Questions = Questions, O extends string = string> {
  readonly huncho: string;
  readonly outcome: O;
  readonly answers: Answers<Q>;
  readonly raw: Record<string, RawAnswer>;
  readonly state: State;
  readonly stateHash: string;
  readonly key: string;
  readonly previous?: string;
  readonly path: readonly string[];
  readonly child?: Decision;
  readonly usage: Usage;
  readonly ms: number;
  readonly provider: string;
  readonly model: string;
}

export interface Huncho<
  I = State,
  Q extends Questions = Questions,
  O extends string = never,
  Branched extends boolean = false,
  D extends string = O,
> {
  readonly name: string;
  readonly questions: Q | undefined;
  readonly policy: Policy<Answers<Q>, O>;
  shape<J>(
    fn: [Branched] extends [true] ? never : (input: J) => State,
  ): [Branched] extends [true] ? never : Huncho<J, Q, O, false, D>;
  ask<R extends Questions>(questions: R): Huncho<I, R, never, false>;
  when<T extends string>(
    test: (answers: Answers<Q>) => boolean,
    outcome: T,
    options?: { readonly exit?: (answers: Answers<Q>) => boolean },
  ): Huncho<I, Q, O | T, Branched, D | T>;
  when<T extends string>(
    select: (answers: Answers<Q>) => number,
    thresholds: { readonly enter: number; readonly exit?: number },
    outcome: T,
  ): Huncho<I, Q, O | T, Branched, D | T>;
  else<T extends string>(outcome: T): Huncho<I, Q, O | T, Branched, D | T>;
  with(
    overrides: { readonly [K in O]?: { readonly enter?: number; readonly exit?: number } },
  ): Huncho<I, Q, O, Branched, D>;
  branch<B extends { readonly [K in keyof B]: K extends O ? NestedHuncho<I> | null : never }>(
    branches: B,
    options?: BranchOptions,
  ): Huncho<I, Q, O, true, O | BranchOutcomes<B>>;
  decide(
    input: I,
    options?: { readonly key?: string; readonly signal?: AbortSignal },
  ): Promise<Decision<Q, D>>;
  evaluate(input: I): Promise<Evaluation<Q>>;
}

type Evaluation<Q extends Questions> = {
  readonly state: State;
  readonly answers: Answers<Q>;
  readonly raw: Record<string, RawAnswer>;
  readonly usage: Usage;
  readonly ms: number;
};

type DecideOptions = { readonly key?: string; readonly signal?: AbortSignal };

/**
 * `speculative` asks every unshaped child's questions in the parent's request,
 * keyed `${outcome}.${questionId}`, so the tree costs one model call. The chosen
 * child settles from those answers with `ms: 0` and zero usage; the parent carries
 * the cost. A child with its own `shape` still gets its own call.
 */
type BranchOptions = { readonly speculative?: boolean };

/** A child huncho may take the parent's input or the parent's state. */
type NestedHuncho<I> =
  | { decide(input: I, options?: DecideOptions): Promise<Decision> }
  | { decide(input: State, options?: DecideOptions): Promise<Decision> };

type NestedOutcome<T> = T extends Huncho<infer _I, infer _Q, infer _O, infer _B, infer D> ? D : never;

type BranchOutcomes<B> = NestedOutcome<B[keyof B]>;

type BranchMap = { readonly [outcome: string]: NestedHuncho<never> | null | undefined };

type Branches = { readonly children: BranchMap; readonly speculative: boolean };

const unbranched: Branches = { children: {}, speculative: false };

/** What a model call cost, as the decision and journal record report it. */
type Cost = Pick<EvaluateResult, "usage" | "ms" | "provider" | "model">;

class HunchoValue<I, Q extends Questions, O extends string, D extends string = O> implements Huncho<I, Q, O, false, D> {
  private readonly memory = new Map<string, string>();
  private readonly tail = new Map<string, Promise<void>>();

  constructor(
    readonly name: string,
    private readonly model: Model,
    private readonly journal: Journal | undefined,
    private readonly toState: (input: I) => State,
    readonly questions: Q | undefined,
    readonly policy: Policy<Answers<Q>, O>,
    private readonly shaped: boolean,
    private readonly branches: Branches,
  ) {}

  shape<J>(fn: (input: J) => State): Huncho<J, Q, O, false, D> {
    if (Object.keys(this.branches.children).length > 0) {
      throw new Error(`huncho "${this.name}" cannot shape after branch`);
    }
    return new HunchoValue<J, Q, O, D>(
      this.name,
      this.model,
      this.journal,
      fn,
      this.questions,
      this.policy,
      true,
      unbranched,
    );
  }

  ask<R extends Questions>(questions: R): Huncho<I, R, never> {
    return new HunchoValue(
      this.name,
      this.model,
      this.journal,
      this.toState,
      questions,
      policy(this.name),
      this.shaped,
      unbranched,
    );
  }

  when<T extends string>(
    test: (answers: Answers<Q>) => boolean,
    outcome: T,
    options?: { readonly exit?: (answers: Answers<Q>) => boolean },
  ): Huncho<I, Q, O | T, false, D | T>;
  when<T extends string>(
    select: (answers: Answers<Q>) => number,
    thresholds: { readonly enter: number; readonly exit?: number },
    outcome: T,
  ): Huncho<I, Q, O | T, false, D | T>;
  when(
    selectOrTest: ((answers: Answers<Q>) => boolean) | ((answers: Answers<Q>) => number),
    outcomeOrThresholds: string | { readonly enter: number; readonly exit?: number },
    optionsOrOutcome?: { readonly exit?: (answers: Answers<Q>) => boolean } | string,
  ): Huncho<I, Q, O | string, false, D | string> {
    const clauses =
      typeof outcomeOrThresholds === "string"
        ? this.policy.when(
            selectOrTest as (answers: Answers<Q>) => boolean,
            outcomeOrThresholds,
            optionsOrOutcome as { readonly exit?: (answers: Answers<Q>) => boolean } | undefined,
          )
        : this.policy.when(
            selectOrTest as (answers: Answers<Q>) => number,
            outcomeOrThresholds,
            optionsOrOutcome as string,
          );
    return new HunchoValue<I, Q, O | string, D | string>(
      this.name,
      this.model,
      this.journal,
      this.toState,
      this.questions,
      clauses,
      this.shaped,
      this.branches,
    );
  }

  else<T extends string>(outcome: T): Huncho<I, Q, O | T, false, D | T> {
    return new HunchoValue<I, Q, O | T, D | T>(
      this.name,
      this.model,
      this.journal,
      this.toState,
      this.questions,
      this.policy.else(outcome),
      this.shaped,
      this.branches,
    );
  }

  with(
    overrides: { readonly [K in O]?: { readonly enter?: number; readonly exit?: number } },
  ): Huncho<I, Q, O, false, D> {
    return new HunchoValue<I, Q, O, D>(
      this.name,
      this.model,
      this.journal,
      this.toState,
      this.questions,
      this.policy.with(overrides),
      this.shaped,
      this.branches,
    );
  }

  branch<B extends { readonly [K in keyof B]: K extends O ? NestedHuncho<I> | null : never }>(
    branches: B,
    options?: BranchOptions,
  ): Huncho<I, Q, O, true, O | BranchOutcomes<B>> {
    return new HunchoValue<I, Q, O, O | BranchOutcomes<B>>(
      this.name,
      this.model,
      this.journal,
      this.toState,
      this.questions,
      this.policy,
      this.shaped,
      { children: { ...branches }, speculative: options?.speculative === true },
    ) as unknown as Huncho<I, Q, O, true, O | BranchOutcomes<B>>;
  }

  async evaluate(input: I): Promise<Evaluation<Q>> {
    const questions = this.requireQuestions();
    const state = this.toState(input);
    const asked = await ask(this.model, state, questions);
    return {
      state,
      answers: asked.answers,
      raw: asked.raw,
      usage: asked.usage,
      ms: asked.ms,
    };
  }

  decide(
    input: I,
    options?: { readonly key?: string; readonly signal?: AbortSignal },
  ): Promise<Decision<Q, D>> {
    const key = options?.key ?? "default";
    return this.enqueue(key, () => this.commit(input, key, options?.signal));
  }

  private enqueue(key: string, work: () => Promise<Decision<Q, D>>): Promise<Decision<Q, D>> {
    const previous = this.tail.get(key) ?? Promise.resolve();
    const run = previous.then(work, work);
    const done = run.then(
      () => undefined,
      () => undefined,
    );
    this.tail.set(key, done);
    void done.then(() => {
      if (this.tail.get(key) === done) this.tail.delete(key);
    });
    return run;
  }

  private async commit(input: I, key: string, signal?: AbortSignal): Promise<Decision<Q, D>> {
    const state = this.toState(input);
    const result = await this.model.evaluate({
      state,
      questions: this.request(),
      ...(signal !== undefined ? { signal } : {}),
    });
    return this.settle(input, state, result.answers, result, key, signal);
  }

  /**
   * Everything after the model: policy with hysteresis, descent, journal.
   * `raw` answers this huncho's request: its own questions plus, under their
   * prefixes, the questions of any speculated children.
   */
  private async settle(
    input: I,
    state: State,
    raw: Record<string, RawAnswer>,
    cost: Cost,
    key: string,
    signal?: AbortSignal,
  ): Promise<Decision<Q, D>> {
    const questions = this.requireQuestions();
    const own = pick(raw, questions);
    const answers = wrapAnswers(own, questions);
    const previous = this.memory.get(key);
    const parentOutcome =
      previous === undefined ? this.policy.decide(answers) : this.policy.decide(answers, previous);
    const child = await this.descend(parentOutcome, input, state, raw, cost, key, signal);
    const path = child === undefined ? [parentOutcome] : [parentOutcome, ...child.path];
    const outcome = (child === undefined ? parentOutcome : child.outcome) as D;
    const [stateHash, questionsHash] = await Promise.all([
      sha256(stableStringify(state)),
      sha256(stableStringify(questions)),
    ]);
    const held = previous !== undefined ? { previous } : {};
    const nested = child === undefined ? {} : { child };
    if (this.journal !== undefined) {
      await this.journal.write({
        t: new Date().toISOString(),
        huncho: this.name,
        key,
        provider: cost.provider,
        model: cost.model,
        stateHash,
        questionsHash,
        answers: own,
        outcome: parentOutcome,
        ...held,
        path,
        usage: cost.usage,
        ms: cost.ms,
      });
    }
    this.memory.set(key, parentOutcome);
    return {
      huncho: this.name,
      outcome,
      answers,
      raw: own,
      state,
      stateHash,
      key,
      ...held,
      path,
      ...nested,
      usage: cost.usage,
      ms: cost.ms,
      provider: cost.provider,
      model: cost.model,
    };
  }

  private async descend(
    parentOutcome: O,
    input: I,
    state: State,
    raw: Record<string, RawAnswer>,
    cost: Cost,
    key: string,
    signal?: AbortSignal,
  ): Promise<Decision | undefined> {
    const nested = this.branches.children[parentOutcome];
    if (nested == null) return undefined;
    if (this.speculates(nested)) {
      // The child was answered in this call, so it reports none of the cost. Unshaped, its input is the state.
      const sliced = strip(raw, `${parentOutcome}.`);
      const prepaid = { ...cost, usage: { inputTokens: 0, outputTokens: 0 }, ms: 0 };
      return nested.enqueue(key, () => nested.settle(state, state, sliced, prepaid, key, signal));
    }
    const options = signal === undefined ? { key } : { key, signal };
    const runner = nested as {
      decide(input: I | State, options?: DecideOptions): Promise<Decision>;
    };
    return runner.decide(nested instanceof HunchoValue && nested.shaped ? input : state, options);
  }

  /** Own questions plus, under `${outcome}.`, the request of every speculated child. */
  private request(): Questions {
    const own = this.requireQuestions();
    if (!this.branches.speculative) return own;
    const merged: Record<string, Question> = { ...own };
    for (const [outcome, nested] of Object.entries(this.branches.children)) {
      if (!this.speculates(nested)) continue;
      for (const [id, question] of Object.entries(nested.request())) {
        const prefixed = `${outcome}.${id}`;
        if (prefixed in merged) throw new Error(`huncho "${this.name}" asks "${prefixed}" twice`);
        merged[prefixed] = question;
      }
    }
    return merged;
  }

  /** A child rides in this request when the branch is speculative and the child has no shape of its own. */
  private speculates(
    nested: NestedHuncho<never> | null | undefined,
  ): nested is HunchoValue<State, Questions, string, string> {
    return this.branches.speculative && nested instanceof HunchoValue && !nested.shaped;
  }

  private requireQuestions(): Q {
    if (this.questions === undefined) throw new Error(`huncho "${this.name}" has no questions`);
    return this.questions;
  }
}

/** Start a named huncho. Builder methods return new values. */
export function huncho(
  name: string,
  options: { readonly model: Model; readonly journal?: Journal },
): Huncho<State, Record<string, never>, never> {
  return new HunchoValue<State, Record<string, never>, never>(
    name,
    options.model,
    options.journal,
    (input) => input,
    undefined,
    policy(name),
    false,
    unbranched,
  );
}

/** The answers to `questions`, in question order. */
function pick(raw: Record<string, RawAnswer>, questions: Questions): Record<string, RawAnswer> {
  const own: Record<string, RawAnswer> = {};
  for (const id of Object.keys(questions)) {
    const answer = raw[id];
    if (answer !== undefined) own[id] = answer;
  }
  return own;
}

/** The answers under `prefix`, with the prefix removed. */
function strip(raw: Record<string, RawAnswer>, prefix: string): Record<string, RawAnswer> {
  const sliced: Record<string, RawAnswer> = {};
  for (const [id, answer] of Object.entries(raw)) {
    if (id.startsWith(prefix)) sliced[id.slice(prefix.length)] = answer;
  }
  return sliced;
}
