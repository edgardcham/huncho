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
export type { Provider } from "./provider.js";
export { createJev, jev } from "./jev.js";
export type { JevOptions } from "./jev.js";
export { ask } from "./ask.js";
export { noul, choice, score, wrapAnswers } from "./questions.js";
export type {
  NoulAnswer,
  ChoiceAnswer,
  ScoreAnswer,
  AnswerOf,
  Answers,
} from "./questions.js";
