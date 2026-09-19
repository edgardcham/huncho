import type { Answers, AnswerOf, ChoiceAnswer, NoulAnswer, ScoreAnswer } from "../src/index.js";
import { choice, noul, score } from "../src/index.js";

const questions = {
  urgent: noul("Need a human within the hour?"),
  topic: choice("What is it about?", ["a", "b"]),
  quality: score("How severe is it?", ["low", "high"]),
};

type Wrapped = Answers<typeof questions>;

function prove(answers: Wrapped) {
  const urgent: NoulAnswer = answers.urgent;
  const topic: ChoiceAnswer<"a" | "b"> = answers.topic;
  const quality: ScoreAnswer = answers.quality;
  const fromBuilder: AnswerOf<(typeof questions)["topic"]> = answers.topic;

  answers.topic.is("a");
  answers.topic.is("b", 0.7);
  urgent.p;
  urgent.yes;
  quality.ratio;
  fromBuilder.is("a");

  // @ts-expect-error — "nope" is not a declared label
  answers.topic.is("nope");

  // @ts-expect-error — noul answers are not choice answers
  const _urgentAsChoice: ChoiceAnswer<"a" | "b"> = answers.urgent;

  // @ts-expect-error — choice answers are not noul answers
  const _topicAsNoul: NoulAnswer = answers.topic;

  // @ts-expect-error — "nope" is not a declared label
  fromBuilder.is("nope");

  void _urgentAsChoice;
  void _topicAsNoul;
}

void prove;
void questions;
