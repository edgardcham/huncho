// Shape: pick, omit, rename, redact, truncate, add. What the model sees.

type Renamed<T, M extends { readonly [K in keyof T]?: string }> = {
  [K in keyof T as K extends keyof M ? (M[K] extends string ? M[K] : K) : K]: T[K];
};

type Redacted<T, K extends keyof T> = { [P in keyof T]: P extends K ? "[redacted]" : T[P] };

type Added<T, K extends string, V> = Omit<T, K> & { readonly [P in K]: V };

export interface Shape<T extends Record<string, unknown>> {
  pick<K extends keyof T>(...keys: K[]): Shape<Pick<T, K>>;
  omit<K extends keyof T>(...keys: K[]): Shape<Omit<T, K>>;
  rename<const M extends { readonly [K in keyof T]?: string }>(map: M): Shape<Renamed<T, M>>;
  redact<K extends keyof T>(...keys: K[]): Shape<Redacted<T, K>>;
  truncate<K extends keyof T>(key: K, max: number): Shape<T>;
  add<K extends string, V>(key: K, value: V): Shape<Added<T, K, V>>;
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

/** Snapshot `obj` and chain projections. The original object is left alone. */
export function shape<T extends Record<string, unknown>>(obj: T): Shape<T> {
  return new ShapeValue({ ...obj });
}
