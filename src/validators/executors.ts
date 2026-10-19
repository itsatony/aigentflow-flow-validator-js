// Executor URI checks.
//
// Until AIgentFlow v2.598.0 the Go static validator did not parse executor URLs
// at all — the live registry decided at dispatch — so this validator carried a
// deliberately loose "is it `scheme://path`" check. DC-FORGE-30 changed that:
// `FlowParser.ValidateFlow` now applies the ONE parser (`ParseExecutorURLString`,
// i.e. `URL_PATTERN_REGEX`) to every step executor, and DC-FORGE-38 extended it
// to `loop.steps[i].executor`. A URL this file accepted and AIgentFlow refuses
// at save is a false PASS — the worst direction for an offline validator — so
// the shape check is now that same regex, mirrored verbatim.
//
// Classification is unchanged:
//   - unparsable URL → error (`invalid_executor_url`): AIgentFlow refuses it too;
//   - unknown scheme → warning (`unknown_executor_scheme`): the vendored list lags
//     the registry, and the Go side never rejects on scheme. See PARITY.md #1.
//
// TEMPLATED URLs ARE SKIPPED, exactly as the Go rule skips them. The engine
// renders `step.executor` as a Go template before dispatch, so
// `flow://stored/{{ .query.child_flow_id }}` is legitimate and cannot be checked
// statically. Omitting this exception rejected eight working bundled flows when
// the Go rule was first written.

import type { Flow, LoopSubStep, StepDefinition } from '../types.js';
import {
  EXECUTOR_SCHEMES,
  EXECUTOR_URL_PATTERN,
  FUNCTION_OPERATIONS,
  TEMPLATE_ACTION_OPEN,
} from '../spec/index.js';
import { Issues, isRecord } from './util.js';

const SCHEME_SEPARATOR = '://';

const UNKNOWN_SCHEME_BASE = (scheme: string): string =>
  `Unknown executor scheme '${scheme}'. It may be valid in a newer AIgentFlow release, or it could be a typo.`;
const DECIDE_SCHEME = 'decide';
const DECIDE_HINT =
  'Decision models run through ai://{provider}/decide (for example ai://openai/decide), not through a scheme of their own.';
const MAX_SCHEME_EDIT_DISTANCE = 2;

/** Levenshtein distance over UTF-16 code units (schemes are ASCII). */
function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j]! + 1,
        cur[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/**
 * The warning text: the base sentence, then for `decide` the pointer to
 * ai://<p>/decide, else a nearest known scheme within edit distance 2
 * (case-insensitive; the closest wins, ties to the alphabetically first).
 */
function unknownSchemeMessage(scheme: string): string {
  const lower = scheme.toLowerCase();
  const base = UNKNOWN_SCHEME_BASE(scheme);
  if (lower === DECIDE_SCHEME) return `${base} ${DECIDE_HINT}`;
  let best: string | undefined;
  let bestDist = MAX_SCHEME_EDIT_DISTANCE + 1;
  for (const known of [...EXECUTOR_SCHEMES].sort()) {
    const d = editDistance(lower, known);
    if (d < bestDist) {
      best = known;
      bestDist = d;
    }
  }
  return best === undefined ? base : `${base} Did you mean '${best}'?`;
}

function checkExecutor(executor: string, field: string, stepID: string, issues: Issues): void {
  const sepIdx = executor.indexOf(SCHEME_SEPARATOR);
  const scheme = sepIdx > 0 ? executor.slice(0, sepIdx) : '';

  // A templated URL is rendered by the engine before dispatch, so its shape
  // cannot be judged here. The scheme is still checked when the scheme itself
  // carries no template, because that half is knowable.
  const templated = executor.includes(TEMPLATE_ACTION_OPEN);

  if (!templated && !EXECUTOR_URL_PATTERN.test(executor)) {
    issues.error({
      field,
      message: `Executor '${executor}' is not a usable executor URL`,
      code: 'invalid_executor_url',
      stepId: stepID,
      suggestion:
        "Use the form 'scheme://authority/path' with a non-empty authority (e.g., 'ai://openai/chat'). " +
        'Authority and path accept letters, digits, underscore and hyphen only.',
    });
    return;
  }

  if (scheme === '' || scheme.includes(TEMPLATE_ACTION_OPEN)) return;

  if (!EXECUTOR_SCHEMES.has(scheme.toLowerCase())) {
    issues.warn({
      field,
      message: unknownSchemeMessage(scheme),
      code: 'unknown_executor_scheme',
      stepId: stepID,
    });
    return;
  }

  checkFunctionOperation(executor, field, stepID, templated, issues);
}

// `unknown_function_operation`: port of `validateFunctionOperationKnown`. Runs
// only for an untemplated, parsable `function://` URL; the scheme match is exact,
// as the reference's parsed type comparison is.
function checkFunctionOperation(
  executor: string,
  field: string,
  stepID: string,
  templated: boolean,
  issues: Issues,
): void {
  if (templated) return;
  const m = EXECUTOR_URL_PATTERN.exec(executor);
  if (m === null || m[1] !== FUNCTION_OPERATIONS.scheme) return;
  const op = `${m[2]}/${m[3]}`;
  if (FUNCTION_OPERATIONS.operations.has(op)) return;
  const list = FUNCTION_OPERATIONS.sorted.join(', ');
  issues.error({
    field,
    message: FUNCTION_OPERATIONS.messageFormat
      .replace('%s', () => JSON.stringify(stepID))
      .replace('%s', () => op)
      .replace('%s', () => list),
    code: FUNCTION_OPERATIONS.code,
    stepId: stepID,
    suggestion: FUNCTION_OPERATIONS.suggestionFormat.replace('%s', () => list),
  });
}

export function validateExecutors(flow: Flow, issues: Issues): void {
  const steps = flow.steps;
  if (!isRecord(steps)) return;

  for (const [stepID, rawStep] of Object.entries(steps)) {
    if (!isRecord(rawStep)) continue;
    const step = rawStep as StepDefinition;

    // A Go `string`: `executor: 42` is the URL "42", refused as a URL.
    const executor = issues.stringOf(step, 'executor', `steps.${stepID}`);
    if (executor !== null && executor !== '') {
      checkExecutor(executor, `steps.${stepID}.executor`, stepID, issues);
    }

    // Loop sub-steps each carry their own executor.
    const loop = step.loop;
    if (isRecord(loop) && Array.isArray(loop.steps)) {
      loop.steps.forEach((sub: unknown, i: number) => {
        if (!isRecord(sub)) return;
        const subStep = sub as LoopSubStep;
        const subPath = `steps.${stepID}.loop.steps[${i}]`;
        const subID = issues.stringOf(subStep, 'id', subPath) ?? String(i);
        const subExecutor = issues.stringOf(subStep, 'executor', subPath);
        if (subExecutor !== null && subExecutor !== '') {
          checkExecutor(
            subExecutor,
            `steps.${stepID}.loop.steps[${i}].executor`,
            `${stepID}.${subID}`,
            issues,
          );
        }
      });
    }
  }
}
