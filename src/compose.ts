// Compose: combine probabilities in code. The model never combines anything.

/** Weakest probability. Empty input is 0. */
export function all(...ps: number[]): number {
  return ps.length === 0 ? 0 : Math.min(...ps);
}

/** Strongest probability. Empty input is 0. */
export function any(...ps: number[]): number {
  return ps.length === 0 ? 0 : Math.max(...ps);
}

/** Weighted mean. Empty input or zero total weight is 0. */
export function weighted(parts: ReadonlyArray<readonly [p: number, weight: number]>): number {
  let mass = 0;
  let sum = 0;
  for (const [p, weight] of parts) {
    sum += p * weight;
    mass += weight;
  }
  return mass === 0 ? 0 : sum / mass;
}

/**
 * True when `p` sits in the open band around 0.5.
 * Default band is 0.15.
 */
export function uncertain(p: number, band = 0.15): boolean {
  return Math.abs(p - 0.5) < band;
}

/**
 * True when any check is at least the threshold.
 * Default threshold is 0.7. Empty input is false. Not a weighted rule.
 */
export function violation(checks: readonly number[], threshold = 0.7): boolean {
  return checks.some((c) => c >= threshold);
}
