// Huncho: shape → model → policy → branches → journal. Per-key hysteresis stays inside.

import { ask } from "./ask.js";
import { sha256, stableStringify, type Journal } from "./journal.js";
import { policy, type Policy } from "./policy.js";
import type { Answers } from "./questions.js";
import type { Model, Questions, RawAnswer, State, Usage } from "./types.js";

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

/** A child huncho may take the parent's input or the parent's state. */
type NestedHuncho<I> =
  | { decide(input: I, options?: DecideOptions): Promise<Decision> }
  | { decide(input: State, options?: DecideOptions): Promise<Decision> };

type NestedOutcome<T> = T extends Huncho<infer _I, infer _Q, infer _O, infer _B, infer D> ? D : never;

type BranchOutcomes<B> = NestedOutcome<B[keyof B]>;

type BranchMap = { readonly [outcome: string]: NestedHuncho<never> | null | undefined };

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
    private readonly branches: BranchMap,
  ) {}

  shape<J>(fn: (input: J) => State): Huncho<J, Q, O, false, D> {
    if (Object.keys(this.branches).length > 0) {
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
      {},
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
      {},
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
  ): Huncho<I, Q, O, true, O | BranchOutcomes<B>> {
    return new HunchoValue<I, Q, O, O | BranchOutcomes<B>>(
      this.name,
      this.model,
      this.journal,
      this.toState,
      this.questions,
      this.policy,
      this.shaped,
      { ...branches },
    ) as unknown as Huncho<I, Q, O, true, O | BranchOutcomes<B>>;
  }

  async evaluate(input: I): Promise<Evaluation<Q>> {
    const { state, asked } = await this.run(input);
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
    const { questions, state, asked } = await this.run(input, signal);
    const previous = this.memory.get(key);
    const parentOutcome =
      previous === undefined ? this.policy.decide(asked.answers) : this.policy.decide(asked.answers, previous);
    const child = await this.descend(parentOutcome, input, state, key, signal);
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
        provider: asked.provider,
        model: asked.model,
        stateHash,
        questionsHash,
        answers: asked.raw,
        outcome: parentOutcome,
        ...held,
        path,
        usage: asked.usage,
        ms: asked.ms,
      });
    }
    this.memory.set(key, parentOutcome);
    return {
      huncho: this.name,
      outcome,
      answers: asked.answers,
      raw: asked.raw,
      state,
      stateHash,
      key,
      ...held,
      path,
      ...nested,
      usage: asked.usage,
      ms: asked.ms,
      provider: asked.provider,
      model: asked.model,
    };
  }

  private async descend(
    parentOutcome: O,
    input: I,
    state: State,
    key: string,
    signal?: AbortSignal,
  ): Promise<Decision | undefined> {
    const nested = this.branches[parentOutcome];
    if (nested == null) return undefined;
    const options = signal === undefined ? { key } : { key, signal };
    const runner = nested as {
      decide(input: I | State, options?: DecideOptions): Promise<Decision>;
    };
    return runner.decide(nested instanceof HunchoValue && nested.shaped ? input : state, options);
  }

  private async run(input: I, signal?: AbortSignal) {
    const questions = this.requireQuestions();
    const state = this.toState(input);
    const asked = await ask(
      this.model,
      state,
      questions,
      signal === undefined ? undefined : { signal },
    );
    return { questions, state, asked };
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
    {},
  );
}
