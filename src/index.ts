// huncho: decisions as code.
// The public surface is assembled slice by slice; see CONTRIBUTING.md for the module map.
import { createGateway } from "./gateway.js";

export const VERSION = "0.1.0";
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
export { createGateway };
export type { GatewayOptions } from "./gateway.js";
/** Lazily configured from `AI_GATEWAY_API_KEY` on first use. */
export const gateway = createGateway();
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
export { memoryJournal, fileJournal, readJournal, stableStringify, sha256 } from "./journal.js";
export type { Journal, JournalRecord } from "./journal.js";
export { huncho } from "./huncho.js";
export type { Huncho, Decision } from "./huncho.js";
export { replay } from "./replay.js";
export type { Replay } from "./replay.js";
export { calibrate } from "./calibrate.js";
export type { CalibrateOptions, Calibration } from "./calibrate.js";
export { shape } from "./shape.js";
export type { Shape } from "./shape.js";
