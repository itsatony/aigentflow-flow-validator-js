// Per-step `output_schema` definition validation (DC-CP-7).
//
// A step may declare `output_schema`, the typed shape of its own output. In the
// Go reference this reuses the SAME structure and validator as `input_schema`
// (`ValidateInputSchemaDefinition` is called verbatim on `step.OutputSchema`),
// so we delegate to the shared `validateSchemaDefinition` and only differ in the
// base field path. It is optional (opt-in): a step without `output_schema` keeps
// lenient behavior. Loop sub-steps may also carry an `output_schema`.
//
// NOTE: the companion `unresolvable_data_path` rule (a `.data.<step>.<field>`
// reference to a field NOT declared in `<step>`'s output_schema) requires
// resolving template field references against the state graph — the same
// runtime concern this validator deliberately does NOT reproduce for templates.
// It is a documented divergence; see PARITY.md.

import type { Flow, LoopSubStep, StepDefinition } from '../types.js';
import { Issues, isArray, isRecord } from './util.js';
import { validateSchemaDefinition } from './inputSchema.js';

export function validateOutputSchemas(flow: Flow, issues: Issues): void {
  const steps = flow.steps;
  if (!isRecord(steps)) return;

  for (const [stepID, rawStep] of Object.entries(steps)) {
    if (!isRecord(rawStep)) continue;
    const step = rawStep as StepDefinition;

    if (step.output_schema !== undefined) {
      validateSchemaDefinition(step.output_schema, `steps.${stepID}.output_schema`, issues);
    }

    // Loop sub-steps each carry their own optional output_schema.
    const loop = step.loop;
    if (isRecord(loop) && isArray(loop.steps)) {
      loop.steps.forEach((sub: unknown, i: number) => {
        if (!isRecord(sub)) return;
        const subStep = sub as LoopSubStep;
        if (subStep.output_schema !== undefined) {
          validateSchemaDefinition(
            subStep.output_schema,
            `steps.${stepID}.loop.steps[${i}].output_schema`,
            issues,
          );
        }
      });
    }
  }
}
