/**
 * huncho: decisions as code. The root entry re-exports every subpath, so one import works everywhere.
 * The public surface is assembled slice by slice; see CONTRIBUTING.md for the module map.
 *
 * @module huncho
 */

/**
 * The package version, the same string `package.json` publishes.
 *
 * @example
 * ```ts
 * import { VERSION } from "huncho";
 *
 * VERSION; // "0.5.0"
 * ```
 */
export const VERSION = "0.5.0";
export { HunchoError, ConfigError, ProviderError, PolicyError, AnswerError } from "./errors.js";
export type {
  Content,
  State,
  NoulQuestion,
  ChoiceQuestion,
  ScoreQuestion,
  Question,
  Questions,
  RawNoulAnswer,
  RawChoiceAnswer,
  RawScoreAnswer,
  RawAnswer,
  Usage,
  EvaluateRequest,
  EvaluateResult,
  Model,
} from "./types.js";
export type { Provider, CreateProviderOptions } from "./provider.js";
export { createProvider } from "./provider.js";
export { createJev, jev } from "./jev.js";
export type { JevOptions } from "./jev.js";
export { createOpenRouter, openrouter } from "./openrouter.js";
export type { OpenRouterOptions } from "./openrouter.js";
export { createGateway, gateway } from "./gateway-provider.js";
export type { GatewayOptions } from "./gateway-provider.js";
export { ask } from "./ask.js";
export { noul, choice, score, wrapAnswers } from "./questions.js";
export type {
  NoulAnswer,
  ChoiceAnswer,
  ScoreAnswer,
  AnswerOf,
  Answers,
} from "./questions.js";
export { policy } from "./policy.js";
export type { Policy } from "./policy.js";
export { all, any, weighted, uncertain, violation } from "./compose.js";
export { memoryJournal, stableStringify, sha256 } from "./journal.js";
export type { Journal, JournalRecord } from "./journal.js";
export { memoryLabels } from "./labels.js";
export type { Label, Labels } from "./labels.js";
export { fileJournal, fileLabels, readJournal } from "./node.js";
export { huncho } from "./huncho.js";
export type { Huncho, Decision } from "./huncho.js";
export { withTracing } from "./otel.js";
export type { Decider, Span, Tracer } from "./otel.js";
export { replay } from "./replay.js";
export type { Replay } from "./replay.js";
export { calibrate } from "./calibrate.js";
export type { CalibrateOptions, Calibration } from "./calibrate.js";
export { sweep } from "./sweep.js";
export type { Candidates, Sweep, SweepOptions } from "./sweep.js";
export { shape } from "./shape.js";
export type { Shape } from "./shape.js";
