import { shape } from "../src/index.js";

const picked = shape({ subject: "invoice", secret: "card" }).pick("subject").build();
const subject: string = picked.subject;

// @ts-expect-error — pick narrows the type
const secret: string = picked.secret;

void subject;
void secret;
