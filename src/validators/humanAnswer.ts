// `human_answer_field` (warning): a human step's answer read under a key no
// answer door commits.
//
// Every door a person answers a human step through commits the same envelope:
// `response`, plus `comments` when they wrote one and `timed_out` when a
// default_response was applied. Nothing else. A flow that reads any other key
// gets "<no value>" with no error at all: a demo flow read
// `.step.response.content` on a human step, the answer rendered `<no value>`, a
// guard ran atoi over it and the run could not continue. Two sites are judged:
//
//   - `.data.<h>.<x>` in any step's template, where h is a human step, and
//   - `.step.response.<x>` in h's OWN `next:` conditions and `post_processing`,
//     the two places where `.step.response` is the answer.
//
// Reference: humanAnswerFieldWarnings (validation.humananswer.go). Scope and
// limits: PARITY.md, package 0.34.0.

import type { Flow } from '../types.js';
import { HUMAN_ANSWER_FIELD } from '../spec/index.js';
import { rootFieldChains } from '../template/gotmpl-fields.js';
import { type Issues, goQuote, isRecord, isString } from './util.js';

const DATA_ROOT = 'data';
const STEP_ROOT = 'step';
const RESPONSE_KEY = 'response';
/** A chain needs a root, a step (or `response`) and the key read. */
const MIN_CHAIN = 3;

/**
 * The top-level steps whose committed data is a person's answer: an executor
 * starting with the human prefix whose remainder is non-empty and whose mode (the
 * remainder's first `/` segment) parks. Loop sub-steps are never answer steps.
 */
export function humanAnswerSteps(flow: Flow): ReadonlySet<string> {
  const out = new Set<string>();
  const steps = flow.steps;
  if (!isRecord(steps)) return out;
  for (const [id, raw] of Object.entries(steps)) {
    if (!isRecord(raw)) continue;
    const executor = raw.executor;
    if (!isString(executor) || !executor.startsWith(HUMAN_ANSWER_FIELD.executorPrefix)) continue;
    const rest = executor.slice(HUMAN_ANSWER_FIELD.executorPrefix.length);
    if (rest === '') continue;
    const mode = rest.split('/')[0] as string;
    if (!HUMAN_ANSWER_FIELD.nonParkingModes.has(mode)) out.add(id);
  }
  return out;
}

/** Go's `fmt.Sprintf` for `%q` (a Go-quoted string) and `%s`, in order. */
function format(fmt: string, args: readonly string[]): string {
  let k = 0;
  return fmt.replace(/%[qs]/g, (verb) => {
    const arg = args[k++] ?? '';
    return verb === '%q' ? goQuote(arg) : arg;
  });
}

/**
 * Whether a template at `field` of top-level step `stepID` runs after that
 * step's answer: its `next:` conditions and its `post_processing`. Its query and
 * pre_processing run before the park; a loop sub-step's paths carry the parent's
 * id and a `.loop.` segment, so they never match.
 */
function isOwnStepResponseSite(field: string, stepID: string): boolean {
  const prefix = `steps.${stepID}.`;
  return (
    field.startsWith(`${prefix}next.conditions[`) || field.startsWith(`${prefix}post_processing[`)
  );
}

/**
 * Warns on every read of a human step's answer under a key no door commits in one
 * template string (`value`) at `field`, a template of step `stepID`. The caller
 * runs it only on a template that parsed.
 */
export function checkHumanAnswerFields(
  value: string,
  field: string,
  stepID: string,
  humanSteps: ReadonlySet<string>,
  issues: Issues,
): void {
  if (humanSteps.size === 0) return;
  const ownAnswerSite = humanSteps.has(stepID) && isOwnStepResponseSite(field, stepID);
  const found = new Map<string, string>();
  for (const chain of rootFieldChains(value)) {
    if (chain.length < MIN_CHAIN) continue;
    const [root, second, key] = chain as [string, string, string];
    if (HUMAN_ANSWER_FIELD.answerKeys.has(key)) continue;
    if (root === DATA_ROOT && humanSteps.has(second)) {
      const message = format(HUMAN_ANSWER_FIELD.dataMessageFormat, [
        stepID,
        second,
        key,
        second,
        second,
        key,
      ]);
      found.set(message, `.${DATA_ROOT}.${second}.${RESPONSE_KEY}`);
    } else if (ownAnswerSite && root === STEP_ROOT && second === RESPONSE_KEY) {
      const message = format(HUMAN_ANSWER_FIELD.stepMessageFormat, [stepID, key, key]);
      found.set(message, `.${STEP_ROOT}.${RESPONSE_KEY}.${RESPONSE_KEY}`);
    }
  }
  for (const message of [...found.keys()].sort()) {
    issues.warn({
      field,
      message,
      code: HUMAN_ANSWER_FIELD.code,
      stepId: stepID,
      suggestion: format(HUMAN_ANSWER_FIELD.suggestionFormat, [found.get(message) as string]),
    });
  }
}
