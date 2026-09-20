// Policy: ordered clauses over answers. Pure; Replay runs it with no model.

import { ConfigError, PolicyError, see } from "./errors.js";

/**
 * Ordered clauses that turn answers into an outcome. Clauses are checked in
 * order and the first active one wins; a numeric clause with `exit` below
 * `enter` holds its outcome until the value drops below `exit` (hysteresis).
 * Every method returns a new policy; `O` accumulates the outcomes declared so far.
 *
 * A huncho builds one of these behind `.when()` and `.else()`. Use `policy()`
 * directly to decide over answers you already have, as `replay` does.
 *
 * @typeParam A The answers a clause reads.
 * @typeParam O The union of outcomes declared so far.
 * @example
 * ```ts
 * import { policy, type Policy } from "huncho";
 *
 * type Signals = { urgency: number; billing: boolean };
 *
 * const route: Policy<Signals, "page" | "billing" | "triage"> = policy<Signals>("support.route")
 *   .when((a) => a.urgency, { enter: 0.8, exit: 0.6 }, "page")
 *   .when((a) => a.billing, "billing")
 *   .else("triage");
 *
 * route.decide({ urgency: 0.7, billing: false });         // "triage"
 * route.decide({ urgency: 0.7, billing: false }, "page"); // "page": held, 0.7 is above exit
 * ```
 */
export interface Policy<A, O extends string = never> {
  /**
   * A boolean clause: active when `test` is true. With `exit`, an outcome this
   * clause produced last time is held while `exit` stays true, even if `test`
   * has gone false.
   *
   * @param test Reads the answers; true enters the outcome.
   * @param outcome What `decide` returns while this clause is active.
   * @param options `exit` keeps a held outcome; omit it and the hold ends as soon as `test` is false.
   * @example
   * ```ts
   * import { policy } from "huncho";
   *
   * const gate = policy<{ p: number }>("gate")
   *   .when((a) => a.p >= 0.8, "open", { exit: (a) => a.p >= 0.6 })
   *   .else("closed");
   *
   * gate.decide({ p: 0.7 });         // "closed"
   * gate.decide({ p: 0.7 }, "open"); // "open": held, exit still true
   * ```
   */
  when<T extends string>(
    test: (answers: A) => boolean,
    outcome: T,
    options?: { readonly exit?: (answers: A) => boolean },
  ): Policy<A, O | T>;
  /**
   * A numeric clause: active when `select` is at least `enter`, and held while
   * it is at least `exit` for a key that produced this outcome last time. `exit`
   * defaults to `enter`, which is no hysteresis.
   *
   * @param select Reads a number from the answers, usually a probability.
   * @param thresholds `enter` and `exit` must be finite with `exit` at most `enter`.
   * @param outcome What `decide` returns while this clause is active.
   * @throws `ConfigError` when a threshold is not finite or `exit` is above `enter`.
   * @example
   * ```ts
   * import { policy } from "huncho";
   *
   * const gate = policy<{ p: number }>("gate")
   *   .when((a) => a.p, { enter: 0.8, exit: 0.6 }, "open")
   *   .else("closed");
   *
   * gate.decide({ p: 0.85 });        // "open"
   * gate.decide({ p: 0.7 }, "open"); // "open": held
   * gate.decide({ p: 0.5 }, "open"); // "closed": below exit
   * ```
   */
  when<T extends string>(
    select: (answers: A) => number,
    thresholds: { readonly enter: number; readonly exit?: number },
    outcome: T,
  ): Policy<A, O | T>;
  /**
   * The outcome when no clause is active. Without one, `decide` throws when
   * nothing matches.
   *
   * @example
   * ```ts
   * import { policy } from "huncho";
   *
   * const gate = policy<{ p: number }>("gate").when((a) => a.p, { enter: 0.8 }, "open").else("closed");
   * gate.decide({ p: 0.1 }); // "closed"
   * ```
   */
  else<T extends string>(outcome: T): Policy<A, O | T>;
  /**
   * The outcome for these answers. Pure: pass `previous`, the outcome this key
   * got last time, and hysteresis applies; omit it and every clause starts cold.
   *
   * @param answers What the clauses read.
   * @param previous The outcome held for this key, if any.
   * @throws `PolicyError` when no clause is active and there is no `else`.
   * @example
   * ```ts
   * import { policy } from "huncho";
   *
   * const gate = policy<{ p: number }>("gate").when((a) => a.p, { enter: 0.8, exit: 0.6 }, "open").else("closed");
   *
   * let held = gate.decide({ p: 0.9 });       // "open"
   * held = gate.decide({ p: 0.7 }, held);     // "open"
   * held = gate.decide({ p: 0.5 }, held);     // "closed"
   * ```
   */
  decide(answers: A, previous?: string): O;
  /**
   * A copy with different thresholds on numeric clauses, keyed by outcome.
   * Boolean clauses and the `else` are unchanged. Override `enter` alone on a
   * clause without hysteresis and `exit` follows it.
   *
   * @throws `ConfigError` when a resulting threshold is not finite or `exit` is above `enter`.
   * @example
   * ```ts
   * import { policy } from "huncho";
   *
   * const gate = policy<{ p: number }>("gate").when((a) => a.p, { enter: 0.8, exit: 0.6 }, "open").else("closed");
   * const stricter = gate.with({ open: { enter: 0.9, exit: 0.7 } });
   *
   * gate.decide({ p: 0.85 });     // "open"
   * stricter.decide({ p: 0.85 }); // "closed"
   * ```
   */
  with(
    overrides: { readonly [K in O]?: { readonly enter?: number; readonly exit?: number } },
  ): Policy<A, O>;
}

type BooleanClause<A> = {
  readonly kind: "boolean";
  readonly outcome: string;
  readonly test: (answers: A) => boolean;
  readonly exit?: (answers: A) => boolean;
};

type NumericClause<A> = {
  readonly kind: "numeric";
  readonly outcome: string;
  readonly select: (answers: A) => number;
  readonly enter: number;
  readonly exit: number;
};

type Clause<A> = BooleanClause<A> | NumericClause<A>;

/**
 * How an outcome was reached: a clause entered on its own, a clause held by
 * hysteresis (`previous` matched and its exit condition held), or the `else`
 * covered it. Carried on every decision, journal record and replay result.
 */
export type Via = "enter" | "hold" | "else";

/** What `explain` returns: `decide`'s outcome and how the policy got there. */
export type Explained<O extends string> = {
  readonly outcome: O;
  readonly via: Via;
};

class PolicyValue<A, O extends string> implements Policy<A, O> {
  constructor(
    private readonly name: string,
    private readonly clauses: readonly Clause<A>[],
    private readonly fallback: string | undefined,
  ) {}

  when<T extends string>(
    test: (answers: A) => boolean,
    outcome: T,
    options?: { readonly exit?: (answers: A) => boolean },
  ): Policy<A, O | T>;
  when<T extends string>(
    select: (answers: A) => number,
    thresholds: { readonly enter: number; readonly exit?: number },
    outcome: T,
  ): Policy<A, O | T>;
  when(
    selectOrTest: ((answers: A) => boolean) | ((answers: A) => number),
    outcomeOrThresholds: string | { readonly enter: number; readonly exit?: number },
    optionsOrOutcome?: { readonly exit?: (answers: A) => boolean } | string,
  ): Policy<A, O | string> {
    const clause =
      typeof outcomeOrThresholds === "string"
        ? booleanClause(
            selectOrTest as (answers: A) => boolean,
            outcomeOrThresholds,
            optionsOrOutcome as { readonly exit?: (answers: A) => boolean } | undefined,
          )
        : numericClause(
            selectOrTest as (answers: A) => number,
            outcomeOrThresholds,
            optionsOrOutcome as string,
          );
    return new PolicyValue(this.name, [...this.clauses, checked(this.name, clause)], this.fallback);
  }

  else<T extends string>(outcome: T): Policy<A, O | T> {
    return new PolicyValue(this.name, this.clauses, outcome);
  }

  decide(answers: A, previous?: string): O {
    return this.explain(answers, previous).outcome;
  }

  explain(answers: A, previous: string | undefined): Explained<O> {
    for (const clause of this.clauses) {
      const via = activation(clause, answers, previous);
      if (via !== undefined) return { outcome: clause.outcome as O, via };
    }
    if (this.fallback !== undefined) return { outcome: this.fallback as O, via: "else" };
    throw new PolicyError(
      `policy "${this.name}": no clause matched and there is no else, ${see("docs/policy.md#clauses")}`,
    );
  }

  with(
    overrides: { readonly [K in O]?: { readonly enter?: number; readonly exit?: number } },
  ): Policy<A, O> {
    const clauses = this.clauses.map((clause) => checked(this.name, applyOverride(clause, overrides)));
    return new PolicyValue(this.name, clauses, this.fallback);
  }
}

/**
 * Start a named policy with no clauses. Chain `when` and `else`, then `decide`.
 * The name appears in the error when `decide` finds no match and no `else`.
 *
 * @typeParam A The answers the clauses will read. Give it explicitly; there is nothing to infer it from yet.
 * @example
 * ```ts
 * import { policy } from "huncho";
 *
 * const gate = policy<{ risk: number; verified: boolean }>("checkout.gate")
 *   .when((a) => a.risk, { enter: 0.8, exit: 0.6 }, "block")
 *   .when((a) => !a.verified, "verify")
 *   .else("allow");
 *
 * gate.decide({ risk: 0.2, verified: true }); // "allow"
 * ```
 */
export function policy<A>(name: string): Policy<A, never> {
  return new PolicyValue(name, [], undefined);
}

/**
 * `decide` and how the outcome was reached. Internal: a huncho and `replay`
 * call it so a decision, its record and a replay result carry `via`; callers
 * use `decide`. Only a policy from `policy()` can explain itself.
 *
 * @throws `ConfigError` when `built` was not made by `policy()`.
 * @throws `PolicyError` when no clause is active and there is no `else`.
 */
export function explain<A, O extends string>(built: Policy<A, O>, answers: A, previous?: string): Explained<O> {
  if (!(built instanceof PolicyValue)) {
    throw new ConfigError(
      `policy was not built by policy(), so it cannot say how it decided, ${see("docs/policy.md#clauses")}`,
    );
  }
  return built.explain(answers, previous);
}

function booleanClause<A>(
  test: (answers: A) => boolean,
  outcome: string,
  options: { readonly exit?: (answers: A) => boolean } | undefined,
): BooleanClause<A> {
  return options?.exit === undefined
    ? { kind: "boolean", outcome, test }
    : { kind: "boolean", outcome, test, exit: options.exit };
}

function numericClause<A>(
  select: (answers: A) => number,
  thresholds: { readonly enter: number; readonly exit?: number },
  outcome: string,
): NumericClause<A> {
  return {
    kind: "numeric",
    outcome,
    select,
    enter: thresholds.enter,
    exit: thresholds.exit ?? thresholds.enter,
  };
}

/** Thresholds must be finite, and a hold cannot demand more than entering did. */
function checked<A>(name: string, clause: Clause<A>): Clause<A> {
  if (clause.kind !== "numeric") return clause;
  if (Number.isFinite(clause.enter) && Number.isFinite(clause.exit) && clause.exit <= clause.enter) return clause;
  throw new ConfigError(
    `policy "${name}": outcome "${clause.outcome}" needs finite thresholds with exit at most enter, got enter ${clause.enter} and exit ${clause.exit}, ${see("docs/policy.md#clauses")}`,
  );
}

/** Whether the clause is active for these answers, and how: entering on its own, or holding a previous outcome. */
function activation<A>(clause: Clause<A>, answers: A, previous: string | undefined): "enter" | "hold" | undefined {
  if (clause.kind === "numeric") {
    const value = clause.select(answers);
    if (value >= clause.enter) return "enter";
    return previous === clause.outcome && value >= clause.exit ? "hold" : undefined;
  }
  if (clause.test(answers)) return "enter";
  return previous === clause.outcome && clause.exit !== undefined && clause.exit(answers) ? "hold" : undefined;
}

function applyOverride<A, O extends string>(
  clause: Clause<A>,
  overrides: { readonly [K in O]?: { readonly enter?: number; readonly exit?: number } },
): Clause<A> {
  if (clause.kind !== "numeric") return clause;
  const override = overrides[clause.outcome as O];
  if (override === undefined) return clause;
  const enter = override.enter ?? clause.enter;
  const exit =
    override.exit ?? (clause.exit === clause.enter ? enter : clause.exit);
  return { ...clause, enter, exit };
}
