// huncho: decisions as code.
// The public surface is assembled slice by slice; see CONTRIBUTING.md for the module map.
export const VERSION = "0.0.1";
export { HunchoError } from "./types.js";
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
export { calibrate } from "./calibrate.js";
export type { CalibrateOptions, Calibration } from "./calibrate.js";
