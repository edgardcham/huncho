// Huncho: shape → model → policy → branches → journal → onDecision. Per-key hysteresis stays inside.

import { ask } from "./ask.js";
import { ConfigError, see } from "./errors.js";
import { sha256, stableStringify, type Journal } from "./journal.js";
import { explain, policy, type Policy, type Via } from "./policy.js";
import { wrapAnswers, type Answers } from "./questions.js";
import type { EvaluateResult, Model, Question, Questions, RawAnswer, State, Usage } from "./types.js";

/**
 * What `decide` returns: the outcome, the typed answers behind it, and enough
 * provenance to explain or replay it. The `JournalRecord` written alongside
 * carries the same provenance with this huncho's own outcome, not the nested one.
 *
 * @typeParam Q The questions asked, so `answers` is typed.
 * @typeParam O The outcome union, including nested branches' outcomes.
 * @example
 * ```ts
 * import { huncho, noul, type Decision, type NoulQuestion } from "huncho";
 * import { jev } from "huncho/jev";
 *
 * const route = huncho("support.route", { model: jev() })
 *   .ask({ urgent: noul("Does this need a human within the hour?") })
 *   .when((a) => a.urgent.p, { enter: 0.8, exit: 0.6 }, "page")
 *   .else("triage");
 *
 * const decision: Decision<{ urgent: NoulQuestion }, "page" | "triage"> = await route.decide("Checkout is down.");
 * decision.outcome;          // "page"
 * decision.via;              // "enter"
 * decision.answers.urgent.p; // 0.91
 * decision.path;             // ["page"]
 * decision.id;               // the same id as the journal record
 * ```
 */
export interface Decision<Q extends Questions = Questions, O extends string = string> {
  /** Unique to this decision and shared with the journal record it wrote. */
  readonly id: string;
  /** The `id` of the decision that chose this one, when this huncho decided as a child in a tree. */
  readonly parentId?: string;
  /** Name of the huncho that decided. */
  readonly huncho: string;
  /** The final outcome: the deepest branch's when there is one, else this huncho's own. */
  readonly outcome: O;
  /** Typed answers to this huncho's questions. */
  readonly answers: Answers<Q>;
  /** The canonical answers as the model returned them. */
  readonly raw: Record<string, RawAnswer>;
  /** What the model saw, after `shape`. */
  readonly state: State;
  /** SHA-256 of `state` in stable JSON, as the journal records it. */
  readonly stateHash: string;
  /** The hysteresis key this decision was made under. `"default"` when none was given. */
  readonly key: string;
  /** How this huncho's own outcome was reached: a clause entered, a clause held its previous outcome, or the `else` covered it. */
  readonly via: Via;
  /** The outcome this key held before this decision, if any. */
  readonly previous?: string;
  /** This huncho's outcome, then each nested branch's, root first. */
  readonly path: readonly string[];
  /** The nested decision, when this outcome had a branch. */
  readonly child?: Decision;
  /** Tokens this huncho's own call consumed. Zero for a child answered speculatively in the parent's call. */
  readonly usage: Usage;
  /** Wall-clock milliseconds for this huncho's own call. */
  readonly ms: number;
  /** Name of the provider that answered. */
  readonly provider: string;
  /** Id of the model that answered. */
  readonly model: string;
}

/**
 * A named decision: what the model sees, what it is asked, and the policy that
 * turns answers into an outcome. Built in that order with `shape`, `ask`, then
 * `when` and `else`; every builder method returns a new value and leaves the
 * old one usable. `decide` runs it, remembering the outcome per key so
 * hysteresis holds across calls.
 *
 * @typeParam I What `decide` takes; `State` until `shape` narrows it.
 * @typeParam Q The questions asked, after `ask`.
 * @typeParam O This huncho's own outcomes, accumulated by `when` and `else`.
 * @typeParam Branched True after `branch`, which closes `shape`.
 * @typeParam D What `decide` can return: `O` plus every nested branch's outcomes.
 * @example
 * ```ts
 * import { choice, huncho, noul } from "huncho";
 * import { jev } from "huncho/jev";
 *
 * type Ticket = { id: string; subject: string; body: string };
 *
 * const route = huncho("support.route", { model: jev() })
 *   .shape((t: Ticket) => ({ subject: t.subject, body: t.body }))
 *   .ask({
 *     urgent: noul("Does this need a human within the hour?"),
 *     topic: choice("What is it about?", ["billing", "bug", "other"]),
 *   })
 *   .when((a) => a.urgent.p, { enter: 0.8, exit: 0.6 }, "page")
 *   .when((a) => a.topic.is("billing", 0.7), "billing")
 *   .else("triage");
 *
 * const ticket: Ticket = { id: "T-1041", subject: "Checkout is down", body: "Every customer gets a 500." };
 * const decision = await route.decide(ticket, { key: ticket.id });
 * decision.outcome; // "page" | "billing" | "triage"
 * ```
 */
export interface Huncho<
  I = State,
  Q extends Questions = Questions,
  O extends string = never,
  Branched extends boolean = false,
  D extends string = O,
> {
  /** The name given to `huncho()`. On every decision, journal record and error. */
  readonly name: string;
  /** The questions from `ask`, or `undefined` before it is called. */
  readonly questions: Q | undefined;
  /** The policy `when` and `else` have built. `replay` runs it over journaled answers. */
  readonly policy: Policy<Answers<Q>, O>;
  /**
   * What the model sees. `fn` takes the input `decide` will receive and
   * returns the state to judge: pick the fields that matter, drop the rest.
   * Call it before `branch`; a branched huncho cannot be reshaped.
   *
   * @param fn Input to state. Its parameter type becomes what `decide` accepts.
   * @throws `ConfigError` when called after `branch`.
   * @example
   * ```ts
   * import { huncho, noul } from "huncho";
   * import { jev } from "huncho/jev";
   *
   * type Ticket = { id: string; subject: string; body: string; internalNotes: string };
   *
   * const route = huncho("support.route", { model: jev() })
   *   .shape((t: Ticket) => ({ subject: t.subject, body: t.body }))
   *   .ask({ urgent: noul("Does this need a human within the hour?") })
   *   .else("triage");
   *
   * await route.decide({ id: "T-1", subject: "Checkout is down", body: "500s", internalNotes: "not sent" });
   * ```
   */
  shape<J>(
    fn: [Branched] extends [true] ? never : (input: J) => State,
  ): [Branched] extends [true] ? never : Huncho<J, Q, O, false, D>;
  /**
   * The questions to ask. Answer types follow from the question types, so
   * the clauses that come next are typed. Calling it again replaces the
   * questions and clears the policy and branches built on the old ones.
   *
   * @example
   * ```ts
   * import { choice, huncho, noul } from "huncho";
   * import { jev } from "huncho/jev";
   *
   * const route = huncho("support.route", { model: jev() }).ask({
   *   urgent: noul("Does this need a human within the hour?"),
   *   topic: choice("What is it about?", ["billing", "bug", "other"]),
   * });
   *
   * const { answers } = await route.evaluate("The invoice is overdue.");
   * answers.topic.p("billing"); // typed: "refund" would not compile
   * ```
   */
  ask<R extends Questions>(questions: R): Huncho<I, R, never, false>;
  /**
   * A boolean clause: active when `test` is true. With `exit`, a key that got
   * this outcome last time keeps it while `exit` stays true. Clauses are
   * checked in the order they were added; the first active one wins.
   *
   * @param test Reads the typed answers; true enters the outcome.
   * @param outcome What `decide` returns while this clause is active.
   * @param options `exit` keeps a held outcome; omit it and the hold ends as soon as `test` is false.
   * @example
   * ```ts
   * import { choice, huncho } from "huncho";
   * import { jev } from "huncho/jev";
   *
   * const route = huncho("support.route", { model: jev() })
   *   .ask({ topic: choice("What is it about?", ["billing", "bug", "other"]) })
   *   .when((a) => a.topic.is("billing", 0.7), "billing", { exit: (a) => a.topic.is("billing", 0.5) })
   *   .else("triage");
   * ```
   */
  when<T extends string>(
    test: (answers: Answers<Q>) => boolean,
    outcome: T,
    options?: { readonly exit?: (answers: Answers<Q>) => boolean },
  ): Huncho<I, Q, O | T, Branched, D | T>;
  /**
   * A numeric clause with hysteresis: active when `select` is at least
   * `enter`, and held for a key that got this outcome last time while it is
   * at least `exit`. `exit` defaults to `enter`. Clauses are checked in the
   * order they were added; the first active one wins.
   *
   * @param select Reads a number from the typed answers, usually a probability.
   * @param thresholds `enter` and `exit` must be finite with `exit` at most `enter`.
   * @param outcome What `decide` returns while this clause is active.
   * @throws `ConfigError` when a threshold is not finite or `exit` is above `enter`.
   * @example
   * ```ts
   * import { huncho, noul } from "huncho";
   * import { jev } from "huncho/jev";
   *
   * const route = huncho("support.route", { model: jev() })
   *   .ask({ urgent: noul("Does this need a human within the hour?") })
   *   .when((a) => a.urgent.p, { enter: 0.8, exit: 0.6 }, "page")
   *   .else("wait");
   *
   * // Enters "page" at 0.8, stays there until urgency drops below 0.6.
   * const first = await route.decide("Checkout is down.", { key: "T-1041" });
   * const later = await route.decide("Checkout is slow.", { key: "T-1041" });
   * later.previous; // first.outcome
   * ```
   */
  when<T extends string>(
    select: (answers: Answers<Q>) => number,
    thresholds: { readonly enter: number; readonly exit?: number },
    outcome: T,
  ): Huncho<I, Q, O | T, Branched, D | T>;
  /**
   * The outcome when no clause is active. Without one, `decide` rejects with
   * a `PolicyError` when nothing matches.
   *
   * @example
   * ```ts
   * import { huncho, noul } from "huncho";
   * import { jev } from "huncho/jev";
   *
   * const route = huncho("support.route", { model: jev() })
   *   .ask({ urgent: noul("Does this need a human within the hour?") })
   *   .when((a) => a.urgent.p, { enter: 0.8 }, "page")
   *   .else("wait");
   * ```
   */
  else<T extends string>(outcome: T): Huncho<I, Q, O | T, Branched, D | T>;
  /**
   * A copy with different thresholds on numeric clauses, keyed by outcome.
   * Questions, boolean clauses, branches and the `else` are unchanged; the copy
   * has its own hysteresis memory. Replay a journal against it to see what
   * would move before switching.
   *
   * @throws `ConfigError` when a resulting threshold is not finite or `exit` is above `enter`.
   * @example
   * ```ts
   * import { huncho, noul, replay } from "huncho";
   * import { jev } from "huncho/jev";
   * import { readJournal } from "huncho/node";
   *
   * const route = huncho("support.route", { model: jev() })
   *   .ask({ urgent: noul("Does this need a human within the hour?") })
   *   .when((a) => a.urgent.p, { enter: 0.8, exit: 0.6 }, "page")
   *   .else("wait");
   *
   * const stricter = route.with({ page: { enter: 0.9, exit: 0.7 } });
   * replay(await readJournal("decisions.jsonl"), stricter).changed; // how many outcomes would move
   * ```
   */
  with(
    overrides: { readonly [K in O]?: { readonly enter?: number; readonly exit?: number } },
  ): Huncho<I, Q, O, Branched, D>;
  /**
   * Hang a child huncho under an outcome. The parent decides first; when its
   * outcome has a child, the child decides next and `path` records the
   * descent. `null` marks an outcome that is deliberately a leaf; every key
   * must be one of this huncho's outcomes. A child with its own `shape` gets
   * the parent's input, otherwise the parent's state.
   *
   * @param branches Outcome to child, or `null` for a leaf.
   * @param options `speculative` asks unshaped children's questions in the parent's call, so the tree costs one round trip.
   * @throws `ConfigError` at decide time when a speculated child's question id collides with a parent's.
   * @example
   * ```ts
   * import { huncho, noul } from "huncho";
   * import { jev } from "huncho/jev";
   *
   * const escalate = huncho("support.escalate", { model: jev() })
   *   .ask({ human: noul("Should a person take this?") })
   *   .when((a) => a.human.p, { enter: 0.8, exit: 0.6 }, "page")
   *   .else("queue");
   *
   * const route = huncho("support.route", { model: jev() })
   *   .ask({ urgent: noul("Does this need a human within the hour?") })
   *   .when((a) => a.urgent.p, { enter: 0.8, exit: 0.6 }, "escalate")
   *   .else("wait")
   *   .branch({ escalate, wait: null }, { speculative: true });
   *
   * const decision = await route.decide("Checkout is down.", { key: "T-1041" });
   * decision.outcome; // "escalate" | "wait" | "page" | "queue"
   * decision.path;    // ["escalate", "page"]
   * ```
   */
  branch<B extends { readonly [K in keyof B]: K extends O ? NestedHuncho<I> | null : never }>(
    branches: B,
    options?: BranchOptions,
  ): Huncho<I, Q, O, true, O | BranchOutcomes<B>>;
  /**
   * Shape, ask the model, apply the policy, descend into a branch, journal,
   * then call `onDecision`. Calls for the same `key` run one at a time, in
   * order, so the held outcome each one sees is the one the previous call
   * produced.
   *
   * @param input What to decide about. `shape` turns it into the state the model sees.
   * @param options `key` is the entity the decision is about, the unit of hysteresis; `"default"` when omitted. `signal` aborts the model call.
   * @throws `ConfigError` when `ask` was never called.
   * @throws `ProviderError` when the model fails to answer.
   * @throws `AnswerError` when an answer is missing or malformed.
   * @throws `PolicyError` when no clause is active and there is no `else`.
   * @example
   * ```ts
   * import { huncho, noul } from "huncho";
   * import { jev } from "huncho/jev";
   *
   * const route = huncho("support.route", { model: jev() })
   *   .ask({ urgent: noul("Does this need a human within the hour?") })
   *   .when((a) => a.urgent.p, { enter: 0.8, exit: 0.6 }, "page")
   *   .else("wait");
   *
   * const decision = await route.decide("Checkout is down.", { key: "T-1041", signal: AbortSignal.timeout(10_000) });
   * decision.outcome;  // "page" | "wait"
   * decision.via;      // "enter" | "hold" | "else": how the outcome was reached
   * decision.previous; // what "T-1041" decided last time, if anything
   * ```
   */
  decide(
    input: I,
    options?: { readonly key?: string; readonly signal?: AbortSignal },
  ): Promise<Decision<Q, D>>;
  /**
   * Ask the model and return the typed answers without deciding: no policy,
   * no hysteresis, no branches, no journal. For looking at what the model
   * says before writing clauses.
   *
   * @throws `ConfigError` when `ask` was never called.
   * @throws `ProviderError` when the model fails to answer.
   * @example
   * ```ts
   * import { huncho, noul } from "huncho";
   * import { jev } from "huncho/jev";
   *
   * const route = huncho("support.route", { model: jev() })
   *   .ask({ urgent: noul("Does this need a human within the hour?") });
   *
   * const { answers, usage } = await route.evaluate("Checkout is down.");
   * answers.urgent.p; // 0.91
   * usage.inputTokens;
   * ```
   */
  evaluate(input: I): Promise<Evaluation<Q>>;
}

/** What `evaluate` returns: the answers and what they cost, with no outcome. */
type Evaluation<Q extends Questions> = {
  /** What the model saw, after `shape`. */
  readonly state: State;
  /** Typed answers, key for key with the questions. */
  readonly answers: Answers<Q>;
  /** The canonical answers as the model returned them. */
  readonly raw: Record<string, RawAnswer>;
  /** Tokens consumed. */
  readonly usage: Usage;
  /** Wall-clock milliseconds for the call. */
  readonly ms: number;
};

type DecideOptions = { readonly key?: string; readonly signal?: AbortSignal };

/** Called with every decision after its journal write. See `huncho()`. */
type DecisionHook = (decision: Decision) => void;

/**
 * `speculative` asks every unshaped child's questions in the parent's request,
 * keyed `${outcome}.${questionId}`, so the tree costs one model call. The chosen
 * child settles from those answers with `ms: 0` and zero usage; the parent carries
 * the cost. A child with its own `shape` still gets its own call.
 */
type BranchOptions = {
  /** Ask unshaped children's questions in the parent's call. Default false. */
  readonly speculative?: boolean;
};

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
    private readonly onDecision: DecisionHook | undefined,
    private readonly toState: (input: I) => State,
    readonly questions: Q | undefined,
    readonly policy: Policy<Answers<Q>, O>,
    private readonly shaped: boolean,
    private readonly branches: Branches,
  ) {}

  shape<J>(fn: (input: J) => State): Huncho<J, Q, O, false, D> {
    if (Object.keys(this.branches.children).length > 0) {
      throw new ConfigError(
        `huncho "${this.name}" cannot shape after branch; call .shape() before .branch(), ${see("docs/nested.md#branch")}`,
      );
    }
    return new HunchoValue<J, Q, O, D>(
      this.name,
      this.model,
      this.journal,
      this.onDecision,
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
      this.onDecision,
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
      this.onDecision,
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
      this.onDecision,
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
      this.onDecision,
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
      this.onDecision,
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
    return this.enqueue(key, () => this.commit(input, key, undefined, options?.signal));
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

  /** One model call, then `settle`. `parentId` is set when a parent's decision chose this huncho. */
  private async commit(
    input: I,
    key: string,
    parentId: string | undefined,
    signal?: AbortSignal,
  ): Promise<Decision<Q, D>> {
    const state = this.toState(input);
    const result = await this.model.evaluate({
      state,
      questions: this.request(),
      ...(signal !== undefined ? { signal } : {}),
    });
    return this.settle(input, state, result.answers, result, key, parentId, signal);
  }

  /**
   * Everything after the model: policy with hysteresis, descent, journal.
   * `raw` answers this huncho's request: its own questions plus, under their
   * prefixes, the questions of any speculated children. The decision's `id` is
   * minted here, so a child gets its own whether or not it made its own call.
   */
  private async settle(
    input: I,
    state: State,
    raw: Record<string, RawAnswer>,
    cost: Cost,
    key: string,
    parentId: string | undefined,
    signal?: AbortSignal,
  ): Promise<Decision<Q, D>> {
    const questions = this.requireQuestions();
    const own = pick(raw, questions);
    const answers = wrapAnswers(own, questions);
    const previous = this.memory.get(key);
    const { outcome: parentOutcome, via } = explain(this.policy, answers, previous);
    const id = globalThis.crypto.randomUUID();
    const child = await this.descend(parentOutcome, id, input, state, raw, cost, key, signal);
    const path = child === undefined ? [parentOutcome] : [parentOutcome, ...child.path];
    const outcome = (child === undefined ? parentOutcome : child.outcome) as D;
    const [stateHash, questionsHash] = await Promise.all([
      sha256(stableStringify(state)),
      sha256(stableStringify(questions)),
    ]);
    const under = parentId !== undefined ? { parentId } : {};
    const held = previous !== undefined ? { previous } : {};
    const nested = child === undefined ? {} : { child };
    if (this.journal !== undefined) {
      await this.journal.write({
        t: new Date().toISOString(),
        id,
        ...under,
        huncho: this.name,
        key,
        provider: cost.provider,
        model: cost.model,
        stateHash,
        questionsHash,
        answers: own,
        outcome: parentOutcome,
        via,
        ...held,
        path,
        usage: cost.usage,
        ms: cost.ms,
      });
    }
    this.memory.set(key, parentOutcome);
    const decision: Decision<Q, D> = {
      id,
      ...under,
      huncho: this.name,
      outcome,
      answers,
      raw: own,
      state,
      stateHash,
      key,
      via,
      ...held,
      path,
      ...nested,
      usage: cost.usage,
      ms: cost.ms,
      provider: cost.provider,
      model: cost.model,
    };
    this.notify(decision);
    return decision;
  }

  /**
   * The hook sees the object `decide` is about to return, after the journal
   * has it. A hook that throws, or returns a promise that rejects, is reported
   * on `console.error`; the decision stands either way.
   */
  private notify(decision: Decision<Q, D>): void {
    if (this.onDecision === undefined) return;
    const report = (err: unknown): void => {
      console.error(
        `huncho "${this.name}": onDecision threw; the decision stands, ${see("docs/observability.md#ondecision")}`,
        err,
      );
    };
    try {
      void Promise.resolve(this.onDecision(decision)).catch(report);
    } catch (err) {
      report(err);
    }
  }

  /** The child under `parentOutcome`, decided under `parentId`, this decision's own id. */
  private async descend(
    parentOutcome: O,
    parentId: string,
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
      return nested.enqueue(key, () => nested.settle(state, state, sliced, prepaid, key, parentId, signal));
    }
    if (nested instanceof HunchoValue) {
      // Its own call, keyed like the parent's and carrying the parent's id. A shaped child shapes the input itself.
      return nested.enqueue(key, () => nested.commit(nested.shaped ? input : state, key, parentId, signal));
    }
    // Anything else that decides gets the state through its public `decide`, which has no place for a parent id.
    const options = signal === undefined ? { key } : { key, signal };
    const runner = nested as { decide(input: State, options?: DecideOptions): Promise<Decision> };
    return runner.decide(state, options);
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
        if (prefixed in merged) {
          throw new ConfigError(
            `huncho "${this.name}" asks "${prefixed}" twice; rename the question or the outcome, ${see("docs/nested.md#one-call-for-the-tree")}`,
          );
        }
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
    if (this.questions === undefined) throw noQuestions(this.name);
    return this.questions;
  }
}

/**
 * Start a named decision. Chain `shape` (optional), `ask`, `when`, `else`,
 * `with` and `branch`; every builder method returns a new value, so a huncho
 * is safe to share and extend. The name goes on every decision, journal
 * record and error it produces.
 *
 * @param name Dotted names read well in a journal: `"support.route"`.
 * @param options `model` answers the questions; `journal`, when given, receives one record per decision; `onDecision`, when given, is called with every decision `decide` returns, after the journal write. A nested huncho calls its own hook with its own decision. A hook that throws, or returns a promise that rejects, is reported on `console.error` and the decision stands.
 * @example
 * ```ts
 * import { choice, huncho, noul } from "huncho";
 * import { jev } from "huncho/jev";
 * import { fileJournal } from "huncho/node";
 *
 * const route = huncho("support.route", {
 *   model: jev(),
 *   journal: fileJournal("decisions.jsonl"),
 *   onDecision: (d) => console.log(`${d.huncho} → ${d.outcome} in ${d.ms} ms`),
 * })
 *   .ask({
 *     urgent: noul("Does this need a human within the hour?"),
 *     topic: choice("What is it about?", ["billing", "bug", "other"]),
 *   })
 *   .when((a) => a.urgent.p, { enter: 0.8, exit: 0.6 }, "page")
 *   .when((a) => a.topic.is("billing", 0.7), "billing")
 *   .else("triage");
 *
 * const decision = await route.decide("The invoice is overdue and the card was declined twice.", { key: "T-1041" });
 * decision.outcome; // "page" | "billing" | "triage"
 * ```
 */
export function huncho(
  name: string,
  options: { readonly model: Model; readonly journal?: Journal; readonly onDecision?: DecisionHook },
): Huncho<State, Record<string, never>, never> {
  return new HunchoValue<State, Record<string, never>, never>(
    name,
    options.model,
    options.journal,
    options.onDecision,
    (input) => input,
    undefined,
    policy(name),
    false,
    unbranched,
  );
}

/** Thrown by anything that needs answers from a huncho that never called `.ask()`. */
export function noQuestions(name: string): ConfigError {
  return new ConfigError(
    `huncho "${name}" has no questions; call .ask() before deciding or replaying, ${see("docs/questions.md#ask")}`,
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
