// Per-step `response_expectation` field validation.
//
// Union of the detailed validator (`validateSemantics` → type must be a known
// data type) and the parser (`ValidateFlow` → array fields require `items`;
// `required` must be a boolean or a string template). See PARITY.md.
//
// Plus `response_expectation_unread` (validation.go
// `validateResponseExpectationIsRead`, AIF DC-FORGE-145): an expectation that
// no evaluation mode will ever read.

import type { Flow, ResponseExpectationField } from '../types.js';
import { DATA_TYPES } from '../spec/index.js';
import { Issues, isRecord, isString } from './util.js';

const TYPE_ARRAY = 'array';
const ASYNC_EXECUTOR_PREFIX = 'async://';
const CODE_RESPONSE_EXPECTATION_UNREAD = 'response_expectation_unread';

/**
 * Go's `%q` for the identifiers a step id can hold. `JSON.stringify` produces
 * the same double-quoted, backslash-escaped form for printable ASCII; the two
 * differ only on non-ASCII and control characters, which no step id carries.
 */
function goQuote(s: string): string {
  return JSON.stringify(s);
}

/**
 * The engine reads `response_expectation` ONLY when `response_evaluation` is
 * set: with no evaluation mode it returns the raw response untouched, so the
 * expectation's `required`, `type` and `fallback` are never consulted. The
 * reference found 25 such steps across 10 of its own bundled flows — among
 * them a requirement meant to fail an answer that had not searched, which
 * would have passed silently.
 *
 * `async://` is exempt: its respond route validates the posted output against
 * the expectation on its own, without any evaluation mode.
 *
 * WARNING, not error, matching the reference: it is consulted at the RUN door
 * over flows that are already stored, and the declaration is INERT — the run
 * does not die. Loop sub-steps cannot declare an expectation, so there is no
 * second step table to walk.
 */
function warnIfUnread(
  stepID: string,
  step: Record<string, unknown>,
  re: Record<string, unknown>,
  issues: Issues,
): void {
  if (Object.keys(re).length === 0) return;
  const evaluation = step.response_evaluation;
  if (evaluation !== undefined && evaluation !== null && evaluation !== '') return;
  if (isString(step.executor) && step.executor.startsWith(ASYNC_EXECUTOR_PREFIX)) return;
  issues.warn({
    field: `steps.${stepID}.response_expectation`,
    message: `response_expectation on step ${goQuote(stepID)} is never checked: the engine reads it only when response_evaluation is set, and this step sets none, so required, type and fallback do nothing. Add response_evaluation: "raw-text" to check these fields against the executor's response unchanged, or remove response_expectation.`,
    code: CODE_RESPONSE_EXPECTATION_UNREAD,
    stepId: stepID,
  });
}

export function validateResponseExpectations(flow: Flow, issues: Issues): void {
  const steps = flow.steps;
  if (!isRecord(steps)) return;

  for (const [stepID, rawStep] of Object.entries(steps)) {
    if (!isRecord(rawStep)) continue;
    const re = rawStep.response_expectation;
    if (re === undefined || re === null) continue;
    if (!isRecord(re)) {
      issues.error({
        field: `steps.${stepID}.response_expectation`,
        message: 'response_expectation must be a mapping',
        code: 'invalid_type',
        stepId: stepID,
      });
      continue;
    }

    warnIfUnread(stepID, rawStep, re, issues);

    for (const [fieldName, rawField] of Object.entries(re)) {
      const base = `steps.${stepID}.response_expectation.${fieldName}`;
      if (!isRecord(rawField)) {
        issues.error({
          field: base,
          message: `response_expectation field '${fieldName}' must be a mapping`,
          code: 'invalid_type',
          stepId: stepID,
        });
        continue;
      }
      const field = rawField as ResponseExpectationField;

      if (!isString(field.type) || !DATA_TYPES.has(field.type)) {
        issues.error({
          field: `${base}.type`,
          message: `Invalid data type: ${field.type ?? '(none)'}`,
          code: 'invalid_data_type',
          stepId: stepID,
          suggestion: `Use one of: ${[...DATA_TYPES].join(', ')}`,
        });
      } else if (field.type === TYPE_ARRAY && (field.items === undefined || field.items === null)) {
        issues.error({
          field: `${base}.items`,
          message: `Array field '${fieldName}' in step '${stepID}' must define 'items'`,
          code: 'response_expectation_array_items_missing',
          stepId: stepID,
        });
      }

      if (field.required !== undefined) {
        const t = typeof field.required;
        if (t !== 'boolean' && t !== 'string') {
          issues.error({
            field: `${base}.required`,
            message: `response_expectation.${fieldName}.required must be a boolean or a string template`,
            code: 'invalid_field_value',
            stepId: stepID,
          });
        }
      }
    }
  }
}
