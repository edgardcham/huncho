// Policy: ordered clauses over answers. Pure; Replay runs it with no model.

export interface Policy<A, O extends string = never> {
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
  else<T extends string>(outcome: T): Policy<A, O | T>;
  decide(answers: A, previous?: string): O;
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
    return new PolicyValue(this.name, [...this.clauses, clause], this.fallback);
  }

  else<T extends string>(outcome: T): Policy<A, O | T> {
    return new PolicyValue(this.name, this.clauses, outcome);
  }

  decide(answers: A, previous?: string): O {
    for (const clause of this.clauses) {
      if (active(clause, answers, previous)) return clause.outcome as O;
    }
    if (this.fallback !== undefined) return this.fallback as O;
    throw new Error(`no outcome for policy "${this.name}"`);
  }

  with(
    overrides: { readonly [K in O]?: { readonly enter?: number; readonly exit?: number } },
  ): Policy<A, O> {
    const clauses = this.clauses.map((clause) => applyOverride(clause, overrides));
    return new PolicyValue(this.name, clauses, this.fallback);
  }
}

/** Start a named policy. The name appears when `decide` finds no match and no `else`. */
export function policy<A>(name: string): Policy<A, never> {
  return new PolicyValue(name, [], undefined);
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

function active<A>(clause: Clause<A>, answers: A, previous: string | undefined): boolean {
  if (clause.kind === "numeric") {
    const value = clause.select(answers);
    if (value >= clause.enter) return true;
    return previous === clause.outcome && value >= clause.exit;
  }
  if (clause.test(answers)) return true;
  return previous === clause.outcome && clause.exit !== undefined && clause.exit(answers);
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
