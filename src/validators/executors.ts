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
import { EXECUTOR_SCHEMES, EXECUTOR_URL_PATTERN, TEMPLATE_ACTION_OPEN } from '../spec/index.js';
import { Issues, isRecord, isString } from './util.js';

const SCHEME_SEPARATOR = '://';

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
      message: `Unknown executor scheme '${scheme}'. It may be valid in a newer AIgentFlow release, or it could be a typo.`,
      code: 'unknown_executor_scheme',
      stepId: stepID,
    });
  }
}

export function validateExecutors(flow: Flow, issues: Issues): void {
  const steps = flow.steps;
  if (!isRecord(steps)) return;

  for (const [stepID, rawStep] of Object.entries(steps)) {
    if (!isRecord(rawStep)) continue;
    const step = rawStep as StepDefinition;

    if (isString(step.executor) && step.executor !== '') {
      checkExecutor(step.executor, `steps.${stepID}.executor`, stepID, issues);
    }

    // Loop sub-steps each carry their own executor.
    const loop = step.loop;
    if (isRecord(loop) && Array.isArray(loop.steps)) {
      loop.steps.forEach((sub: unknown, i: number) => {
        if (!isRecord(sub)) return;
        const subStep = sub as LoopSubStep;
        const subID = isString(subStep.id) ? subStep.id : String(i);
        if (isString(subStep.executor) && subStep.executor !== '') {
          checkExecutor(
            subStep.executor,
            `steps.${stepID}.loop.steps[${i}].executor`,
            `${stepID}.${subID}`,
            issues,
          );
        }
      });
    }
  }
}
