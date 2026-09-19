// Agent tool-call gate: judge each proposed call against a written policy before it runs.
// The policy file is part of the state the model sees. Combining answers happens in code:
// `violation` blocks on any serious finding, `uncertain` asks a person instead of guessing.

import { readFile } from "node:fs/promises";
import { huncho, jev, noul, uncertain, violation } from "../src/index.js";

type ToolCall = { tool: string; arguments: Record<string, unknown> };

const policy = await readFile("examples/tool-policy.md", "utf8");

const gate = huncho("agent.tool-gate", { model: jev() })
  .shape((call: ToolCall) => ({ policy, tool: call.tool, arguments: call.arguments }))
  .ask({
    destructive: noul("Would this call delete or overwrite data that cannot be recovered?"),
    exfiltrates: noul("Would this call send data outside the company?"),
    offPolicy: noul("Does this call break a rule in the policy?"),
  })
  .when((a) => violation([a.destructive.p, a.exfiltrates.p, a.offPolicy.p]), "block")
  .when((a) => uncertain(a.offPolicy.p, 0.2), "ask")
  .else("allow");

const calls: ToolCall[] = [
  { tool: "read_file", arguments: { path: "docs/roadmap.md" } },
  {
    tool: "send_email",
    arguments: { to: "reporter@news.example.org", subject: "Q3 numbers", body: "Attached as requested." },
  },
  { tool: "run_shell", arguments: { command: "rm -rf build/" } },
  { tool: "update_record", arguments: { table: "customers", id: 4821, set: { plan: "enterprise" } } },
];

for (const call of calls) {
  const decision = await gate.decide(call, { key: call.tool });
  const { destructive, exfiltrates, offPolicy } = decision.answers;
  console.log(
    `${decision.outcome.padEnd(5)} ${call.tool}`,
    `destructive=${destructive.p.toFixed(2)} exfiltrates=${exfiltrates.p.toFixed(2)} offPolicy=${offPolicy.p.toFixed(2)}`,
  );
}
