import { policy } from "../src/index.js";

const route = policy<{ value: number; flag: boolean }>("route")
  .when((a) => a.value, { enter: 0.8, exit: 0.6 }, "page")
  .when((a) => a.flag, "billing")
  .else("wait");

function prove(value: number, flag: boolean) {
  const outcome: "page" | "billing" | "wait" = route.decide({ value, flag });

  // @ts-expect-error — decide returns the accumulated outcome union
  const onlyPage: "page" = route.decide({ value, flag });

  const pageOnly = policy<{ value: number }>("page-only").when((a) => a.value, { enter: 0.8 }, "page");
  const page: "page" = pageOnly.decide({ value });

  // @ts-expect-error — else has not added "wait" to the union
  const wait: "wait" = pageOnly.decide({ value });

  void outcome;
  void onlyPage;
  void page;
  void wait;
}

void prove;
void route;
