import { shape } from "../src/index.js";

const picked = shape({ subject: "invoice", secret: "card" }).pick("subject").build();
const subject: string = picked.subject;

// @ts-expect-error — pick narrows the type
const secret: string = picked.secret;

const overwritten = shape({ subject: "invoice" }).add("subject", 123).build();
const n: number = overwritten.subject;

// @ts-expect-error — add overwrites the previous type
const stillString: string = overwritten.subject;

void subject;
void secret;
void n;
void stillString;
