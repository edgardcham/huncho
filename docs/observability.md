---
title: Observability
description: See every decision as it happens, with a hook or with one OpenTelemetry span per decide.
---

The journal is the record. Two hooks make decisions visible as they happen.

## onDecision

`onDecision` is called with every decision `decide` returns, after that huncho's journal write, once per huncho in a tree: a child with its own decision, then the parent. `evaluate` and a rejected `decide` never call it.

```ts
import { huncho, noul } from "huncho";
import { jev } from "huncho/jev";

const route = huncho("support.route", {
  model: jev(),
  onDecision: (d) => metrics.increment("decisions", { huncho: d.huncho, outcome: d.outcome }),
})
  .ask({ urgent: noul("Does this need a human within the hour?") })
  .when((a) => a.urgent.p, { enter: 0.8, exit: 0.6 }, "page")
  .else("wait");
```

A hook that throws, or returns a promise that rejects, is reported on `console.error` and never fails the decision. The decision stands; the hook is for looking, not for deciding.

## withTracing

`withTracing(huncho, tracer)` from `huncho/otel` wraps `decide` in one span per call, named after the huncho. When the decision resolves the span carries `huncho.outcome`, `huncho.provider`, `huncho.model`, `huncho.ms`, `huncho.usage.input_tokens` and `huncho.usage.output_tokens`, the values the `Decision` reports. A rejected `decide` records the exception and an error status on the span and rethrows.

```ts
import { trace } from "@opentelemetry/api";
import { withTracing } from "huncho/otel";

const traced = withTracing(route, trace.getTracer("huncho"));
await traced.decide(ticket, { key: ticket.id }); // one span, "support.route"
```

The tracer is typed by shape: `Tracer` is anything with `startActiveSpan`, and `Span` anything with `setAttributes`, `recordException`, `setStatus` and `end`, declared as the OpenTelemetry API declares them, so `trace.getTracer("huncho")` fits without a cast and huncho imports nothing from OpenTelemetry. Anything else with `startActiveSpan`, a logging stand-in in a test for instance, fits the same way.

The span is active for the whole call, so spans your HTTP instrumentation opens for the model request nest under it, and a [nested huncho](nested.md) decides inside its parent's span without a span of its own; `ms` and usage on the span are the root's own call.

The traced value decides and nothing else. It is a `Decider`, the part of a `Huncho` that has `name` and `decide`, so wrap a huncho after its builder chain, not before.
