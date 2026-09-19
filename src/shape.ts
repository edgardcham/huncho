// Shape: pick, omit, rename, redact, truncate, add. What the model sees.

type Renamed<T, M extends { readonly [K in keyof T]?: string }> = {
  [K in keyof T as K extends keyof M ? (M[K] extends string ? M[K] : K) : K]: T[K];
};

type Redacted<T, K extends keyof T> = { [P in keyof T]: P extends K ? "[redacted]" : T[P] };

type Added<T, K extends string, V> = Omit<T, K> & { readonly [P in K]: V };

/**
 * A chain of projections over one object, ending in `build()`. Each step
 * returns a new `Shape` with the type narrowed to match, so the model sees
 * exactly what you built and nothing else.
 *
 * @example
 * ```ts
 * import { huncho, noul, shape } from "huncho";
 * import { jev } from "huncho/jev";
 *
 * type Ticket = { id: string; subject: string; body: string; email: string; internalNotes: string };
 *
 * const route = huncho("support.route", { model: jev() })
 *   .shape((t: Ticket) => shape(t).omit("internalNotes").redact("email").truncate("body", 2000).build())
 *   .ask({ urgent: noul("Does this need a human within the hour?") })
 *   .else("wait");
 * ```
 */
export interface Shape<T extends Record<string, unknown>> {
  /**
   * Keep only these keys.
   *
   * @example
   * ```ts
   * import { shape } from "huncho";
   *
   * shape({ id: "T-1", subject: "Checkout is down", body: "500s" }).pick("subject", "body").build();
   * // { subject: "Checkout is down", body: "500s" }
   * ```
   */
  pick<K extends keyof T>(...keys: K[]): Shape<Pick<T, K>>;
  /**
   * Drop these keys.
   *
   * @example
   * ```ts
   * import { shape } from "huncho";
   *
   * shape({ id: "T-1", subject: "Checkout is down", internalNotes: "vip" }).omit("internalNotes").build();
   * // { id: "T-1", subject: "Checkout is down" }
   * ```
   */
  omit<K extends keyof T>(...keys: K[]): Shape<Omit<T, K>>;
  /**
   * Rename keys, old name to new. Keys not in the map keep their names.
   *
   * @example
   * ```ts
   * import { shape } from "huncho";
   *
   * shape({ subj: "Checkout is down", txt: "500s" }).rename({ subj: "subject", txt: "body" }).build();
   * // { subject: "Checkout is down", body: "500s" }
   * ```
   */
  rename<const M extends { readonly [K in keyof T]?: string }>(map: M): Shape<Renamed<T, M>>;
  /**
   * Replace these values with `"[redacted]"`, keeping the keys so the model
   * knows the field exists.
   *
   * @example
   * ```ts
   * import { shape } from "huncho";
   *
   * shape({ subject: "Refund", email: "ana@example.com" }).redact("email").build();
   * // { subject: "Refund", email: "[redacted]" }
   * ```
   */
  redact<K extends keyof T>(...keys: K[]): Shape<Redacted<T, K>>;
  /**
   * Keep `max` characters of a string value, the start and the end, with an
   * `[...N omitted...]` marker between them, so the result is a little longer
   * than `max`. Values that are not strings, or already fit, are left alone.
   *
   * @example
   * ```ts
   * import { shape } from "huncho";
   *
   * const { body } = shape({ body: "a".repeat(5000) }).truncate("body", 2000).build();
   * body.length; // 2000 plus the marker
   * body.includes("[...3000 omitted...]"); // true
   * ```
   */
  truncate<K extends keyof T>(key: K, max: number): Shape<T>;
  /**
   * Add a key, or replace one, with a value the model should also see.
   *
   * @example
   * ```ts
   * import { shape } from "huncho";
   *
   * shape({ subject: "Checkout is down" }).add("plan", "enterprise").build();
   * // { subject: "Checkout is down", plan: "enterprise" }
   * ```
   */
  add<K extends string, V>(key: K, value: V): Shape<Added<T, K, V>>;
  /**
   * The projected object, a fresh copy.
   *
   * @example
   * ```ts
   * import { shape } from "huncho";
   *
   * const state = shape({ id: "T-1", subject: "Checkout is down" }).pick("subject").build();
   * state.subject; // "Checkout is down"
   * ```
   */
  build(): T;
}

function record(entries: Iterable<readonly [PropertyKey, unknown]>): Record<string, unknown> {
  return Object.fromEntries(entries);
}

class ShapeValue<T extends Record<string, unknown>> implements Shape<T> {
  constructor(private readonly value: T) {}

  pick<K extends keyof T>(...keys: K[]): Shape<Pick<T, K>> {
    return new ShapeValue(record(keys.map((key) => [key, this.value[key]])) as Pick<T, K>);
  }

  omit<K extends keyof T>(...keys: K[]): Shape<Omit<T, K>> {
    const next = { ...this.value };
    for (const key of keys) delete next[key];
    return new ShapeValue(next);
  }

  rename<const M extends { readonly [K in keyof T]?: string }>(map: M): Shape<Renamed<T, M>> {
    return new ShapeValue(
      record(
        Object.entries(this.value).map(([key, value]) => {
          const renamed = map[key as keyof T];
          return [typeof renamed === "string" ? renamed : key, value];
        }),
      ) as Renamed<T, M>,
    );
  }

  redact<K extends keyof T>(...keys: K[]): Shape<Redacted<T, K>> {
    return new ShapeValue({
      ...this.value,
      ...record(keys.map((key) => [key, "[redacted]"])),
    } as Redacted<T, K>);
  }

  truncate<K extends keyof T>(key: K, max: number): Shape<T> {
    const value = this.value[key];
    const keep = Math.floor(max);
    if (typeof value !== "string" || !(keep >= 0) || value.length <= keep) return this;
    const tail = Math.floor(keep / 2);
    const cut = `${value.slice(0, keep - tail)}[...${value.length - keep} omitted...]${value.slice(value.length - tail)}`;
    return new ShapeValue({ ...this.value, [key]: cut } as T);
  }

  add<K extends string, V>(key: K, value: V): Shape<Added<T, K, V>> {
    return new ShapeValue({ ...this.value, [key]: value } as Added<T, K, V>);
  }

  build(): T {
    return { ...this.value };
  }
}

/**
 * Snapshot `obj` and chain projections: `pick`, `omit`, `rename`, `redact`,
 * `truncate`, `add`, then `build()`. The original object is left alone.
 * Made for a huncho's `shape()` step, to trim what the model sees.
 *
 * @example
 * ```ts
 * import { shape } from "huncho";
 *
 * const ticket = { id: "T-1041", subject: "Checkout is down", body: "Every customer gets a 500.", email: "ana@example.com" };
 * const state = shape(ticket).omit("id").redact("email").truncate("body", 2000).build();
 * state.email; // "[redacted]"
 * ```
 */
export function shape<T extends Record<string, unknown>>(obj: T): Shape<T> {
  return new ShapeValue({ ...obj });
}
