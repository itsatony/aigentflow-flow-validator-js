// A step `max_duration:` the reference's engine cannot turn into a deadline.
//
// Mirrors `validateStepMaxDurationIsApplied` (validation.go, AIF DC-FORGE-147).
// The reference bounds each executor invocation of a step by its
// `max_duration`. Two declarations fall outside that, and both are WARNINGS:
//
// - a value that does not parse as a Go duration. The engine runs the step
//   with no time limit rather than fail a stored flow at its run door.
// - a value on a `loop:` step, which makes no executor call of its own.
//
// Loop sub-steps have no `max_duration` field in the reference, so there is no
// second step table to walk.

import type { Flow } from '../types.js';
import { Issues, isRecord, parseGoDuration } from './util.js';

const CODE_STEP_MAX_DURATION_IGNORED = 'step_max_duration_ignored';
const FIELD_MAX_DURATION = 'max_duration';

/** The reference's no-bound spellings (shared with its async/HITL park expiry). */
const NO_BOUND_SPELLINGS: ReadonlySet<string> = new Set(['none', 'never', 'infinite']);

/** Go's `%q` for the strings this rule quotes — see unreadLimits' note on non-ASCII. */
function goQuote(s: string): string {
  return JSON.stringify(s);
}

/**
 * The reference's `parseStepMaxDuration`: true when the value is a no-bound
 * spelling or a Go `time.ParseDuration` string. "0s" and negative values parse
 * (the engine treats them as no bound), so they do not warn.
 */
export function isApplicableStepMaxDuration(raw: string): boolean {
  return NO_BOUND_SPELLINGS.has(raw) || parseGoDuration(raw) !== null;
}

/**
 * The reference's field is a Go `string`, and YAML decoding into it accepts any
 * scalar: `max_duration: 90` arrives as "90", which then fails to parse. A
 * parsed YAML number is therefore read back as its decimal text.
 */
function declaredMaxDuration(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

export function validateStepMaxDuration(flow: Flow, issues: Issues): void {
  const steps = flow.steps;
  if (!isRecord(steps)) return;
  for (const [stepID, rawStep] of Object.entries(steps)) {
    if (!isRecord(rawStep)) continue;
    const declared = declaredMaxDuration(rawStep[FIELD_MAX_DURATION]);
    if (declared === null || declared === '') continue;
    const field = `steps.${stepID}.${FIELD_MAX_DURATION}`;
    if (!isApplicableStepMaxDuration(declared)) {
      issues.warn({
        field,
        message: `max_duration ${goQuote(declared)} on step ${goQuote(stepID)} is not a duration, so the step runs with no time limit. Use a Go duration such as "90s", "5m" or "2h" (there is no day unit: write "48h", not "2d"; templates are not rendered here), or "none" for no limit.`,
        code: CODE_STEP_MAX_DURATION_IGNORED,
      });
      continue;
    }
    if (isRecord(rawStep.loop)) {
      issues.warn({
        field,
        message: `max_duration ${goQuote(declared)} on loop step ${goQuote(stepID)} bounds nothing: a loop step makes no executor call of its own, and loop sub-steps have no max_duration key. Bound the loop with loop.max_iterations, or remove max_duration.`,
        code: CODE_STEP_MAX_DURATION_IGNORED,
      });
    }
  }
}
