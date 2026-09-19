// Huncho: shape → model → policy → journal. Per-key hysteresis stays inside.

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
  readonly usage: Usage;
  readonly ms: number;
  readonly provider: string;
  readonly model: string;
}

export interface Huncho<I = State, Q extends Questions = Questions, O extends string = never> {
  shape<J>(fn: (input: J) => State): Huncho<J, Q, O>;
  ask<R extends Questions>(questions: R): Huncho<I, R, O>;
  when<T extends string>(
    test: (answers: Answers<Q>) => boolean,
    outcome: T,
    options?: { readonly exit?: (answers: Answers<Q>) => boolean },
  ): Huncho<I, Q, O | T>;
  when<T extends string>(
    select: (answers: Answers<Q>) => number,
    thresholds: { readonly enter: number; readonly exit?: number },
    outcome: T,
  ): Huncho<I, Q, O | T>;
  else<T extends string>(outcome: T): Huncho<I, Q, O | T>;
  decide(
    input: I,
    options?: { readonly key?: string; readonly signal?: AbortSignal },
  ): Promise<Decision<Q, O>>;
  evaluate(input: I): Promise<Evaluation<Q>>;
}

type Evaluation<Q extends Questions> = {
  readonly state: State;
  readonly answers: Answers<Q>;
  readonly raw: Record<string, RawAnswer>;
  readonly usage: Usage;
  readonly ms: number;
};

type Memory = Map<string, string>;

class HunchoValue<I, Q extends Questions, O extends string> implements Huncho<I, Q, O> {
  constructor(
    private readonly name: string,
    private readonly model: Model,
    private readonly journal: Journal | undefined,
    private readonly memory: Memory,
    private readonly toState: (input: I) => State,
    private readonly questions: Q | undefined,
    private readonly clauses: Policy<Answers<Q>, O>,
  ) {}

  shape<J>(fn: (input: J) => State): Huncho<J, Q, O> {
    return new HunchoValue(this.name, this.model, this.journal, this.memory, fn, this.questions, this.clauses);
  }

  ask<R extends Questions>(questions: R): Huncho<I, R, O> {
    return new HunchoValue(
      this.name,
      this.model,
      this.journal,
      this.memory,
      this.toState,
      questions,
      this.clauses as unknown as Policy<Answers<R>, O>,
    );
  }

  when<T extends string>(
    test: (answers: Answers<Q>) => boolean,
    outcome: T,
    options?: { readonly exit?: (answers: Answers<Q>) => boolean },
  ): Huncho<I, Q, O | T>;
  when<T extends string>(
    select: (answers: Answers<Q>) => number,
    thresholds: { readonly enter: number; readonly exit?: number },
    outcome: T,
  ): Huncho<I, Q, O | T>;
  when(
    selectOrTest: ((answers: Answers<Q>) => boolean) | ((answers: Answers<Q>) => number),
    outcomeOrThresholds: string | { readonly enter: number; readonly exit?: number },
    optionsOrOutcome?: { readonly exit?: (answers: Answers<Q>) => boolean } | string,
  ): Huncho<I, Q, O | string> {
    const clauses =
      typeof outcomeOrThresholds === "string"
        ? this.clauses.when(
            selectOrTest as (answers: Answers<Q>) => boolean,
            outcomeOrThresholds,
            optionsOrOutcome as { readonly exit?: (answers: Answers<Q>) => boolean } | undefined,
          )
        : this.clauses.when(
            selectOrTest as (answers: Answers<Q>) => number,
            outcomeOrThresholds,
            optionsOrOutcome as string,
          );
    return new HunchoValue(this.name, this.model, this.journal, this.memory, this.toState, this.questions, clauses);
  }

  else<T extends string>(outcome: T): Huncho<I, Q, O | T> {
    return new HunchoValue(
      this.name,
      this.model,
      this.journal,
      this.memory,
      this.toState,
      this.questions,
      this.clauses.else(outcome),
    );
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

  async decide(
    input: I,
    options?: { readonly key?: string; readonly signal?: AbortSignal },
  ): Promise<Decision<Q, O>> {
    const key = options?.key ?? "default";
    const { questions, state, asked } = await this.run(input, options?.signal);
    const previous = this.memory.get(key);
    const outcome =
      previous === undefined ? this.clauses.decide(asked.answers) : this.clauses.decide(asked.answers, previous);
    const [stateHash, questionsHash] = await Promise.all([
      sha256(stableStringify(state)),
      sha256(stableStringify(questions)),
    ]);
    const held = previous !== undefined ? { previous } : {};
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
        outcome,
        ...held,
        path: [outcome],
        usage: asked.usage,
        ms: asked.ms,
      });
    }
    this.memory.set(key, outcome);
    return {
      huncho: this.name,
      outcome,
      answers: asked.answers,
      raw: asked.raw,
      state,
      stateHash,
      key,
      ...held,
      path: [outcome],
      usage: asked.usage,
      ms: asked.ms,
      provider: asked.provider,
      model: asked.model,
    };
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
    new Map(),
    (input) => input,
    undefined,
    policy(name),
  );
}
