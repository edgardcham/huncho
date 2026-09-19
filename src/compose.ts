// Compose: combine probabilities in code. The model never combines anything.

import { ConfigError, see } from "./errors.js";

/**
 * Weakest probability: the chance that every check holds is at most the least
 * likely one. Empty input is 0.
 *
 * @example
 * ```ts
 * import { all } from "huncho";
 *
 * all(0.9, 0.7, 0.95); // 0.7
 * all();               // 0
 * ```
 */
export function all(...ps: number[]): number {
  return ps.length === 0 ? 0 : Math.min(...ps);
}

/**
 * Strongest probability: the chance that at least one check holds is at least
 * the most likely one. Empty input is 0.
 *
 * @example
 * ```ts
 * import { any } from "huncho";
 *
 * any(0.1, 0.6, 0.3); // 0.6
 * any();              // 0
 * ```
 */
export function any(...ps: number[]): number {
  return ps.length === 0 ? 0 : Math.max(...ps);
}

/**
 * Weighted mean of probabilities. Empty input or zero total weight is 0.
 *
 * @param parts `[probability, weight]` pairs. Probabilities must be finite; weights finite and non-negative.
 * @throws `ConfigError` when a probability is not finite or a weight is negative or not finite.
 * @example
 * ```ts
 * import { weighted } from "huncho";
 *
 * weighted([[0.9, 2], [0.3, 1]]); // 0.7
 * weighted([]);                   // 0
 * ```
 */
export function weighted(parts: ReadonlyArray<readonly [p: number, weight: number]>): number {
  let mass = 0;
  let sum = 0;
  for (const [p, weight] of parts) {
    if (!Number.isFinite(p) || !Number.isFinite(weight) || weight < 0) {
      throw new ConfigError(
        `weighted() needs finite probabilities and non-negative weights, ${see("docs/policy.md#compose-helpers")}`,
      );
    }
    sum += p * weight;
    mass += weight;
  }
  return mass === 0 ? 0 : sum / mass;
}

/**
 * True when `p` sits in the open band around 0.5, where a probability means
 * "don't know" rather than "medium". Default band is 0.15, so 0.35 < p < 0.65.
 *
 * @example
 * ```ts
 * import { uncertain } from "huncho";
 *
 * uncertain(0.52);      // true
 * uncertain(0.8);       // false
 * uncertain(0.6, 0.05); // false
 * ```
 */
export function uncertain(p: number, band = 0.15): boolean {
  return Math.abs(p - 0.5) < band;
}

/**
 * True when any check is at least the threshold. One strong signal is enough;
 * this is not a weighted rule. Default threshold is 0.7. Empty input is false.
 *
 * @example
 * ```ts
 * import { violation } from "huncho";
 *
 * violation([0.1, 0.05, 0.92]); // true
 * violation([0.6, 0.65]);       // false
 * violation([0.6, 0.65], 0.5);  // true
 * ```
 */
export function violation(checks: readonly number[], threshold = 0.7): boolean {
  return checks.some((c) => c >= threshold);
}
