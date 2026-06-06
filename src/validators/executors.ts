// Executor URI checks.
//
// The Go static validator does not reject executor URIs (the live executor
// registry is the source of truth, and schemes are added frequently). This
// validator adds two authoring-time aids, classified conservatively:
//   - malformed URI (no `scheme://path`) → error (always genuinely broken);
//   - unknown scheme → warning (the vendored list can lag the registry).
// See PARITY.md.

import type { Flow, LoopSubStep, StepDefinition } from '../types.js';
import { EXECUTOR_SCHEMES } from '../spec/index.js';
import { Issues, isRecord, isString } from './util.js';

const SCHEME_SEPARATOR = '://';
const SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.\-_]*$/;

function checkExecutor(executor: string, field: string, stepID: string, issues: Issues): void {
  const sepIdx = executor.indexOf(SCHEME_SEPARATOR);
  if (sepIdx <= 0) {
    issues.error({
      field,
      message: `Executor '${executor}' is not a valid '<scheme>://<path>' URI`,
      code: 'invalid_executor_url',
      stepId: stepID,
      suggestion: "Use the form 'scheme://path' (e.g., 'ai://openai/chat')",
    });
    return;
  }
  const scheme = executor.slice(0, sepIdx);
  const path = executor.slice(sepIdx + SCHEME_SEPARATOR.length);

  if (!SCHEME_PATTERN.test(scheme)) {
    issues.error({
      field,
      message: `Executor scheme '${scheme}' is not a valid identifier`,
      code: 'invalid_executor_url',
      stepId: stepID,
    });
    return;
  }
  if (path === '') {
    issues.error({
      field,
      message: `Executor '${executor}' has an empty path after '://'`,
      code: 'invalid_executor_url',
      stepId: stepID,
    });
    return;
  }

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
