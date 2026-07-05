// Per-step `quality_gate:` block validation (DC-CP-8).
//
// Mirrors `FlowParser.validateQualityGate` (parser.go): rubric non-empty;
// threshold in [0,1]; on_fail ∈ {fail,goto,retry} (the Go enum also lists
// `human`, but it is validation-REJECTED pending the human-task inbox, so we
// reject it too — with its own code); when on_fail=goto, goto_step is required,
// must name an existing step, and must not point at the gate's own step (a
// failing self-goto loops forever). The Go layer additionally refuses a gate on
// a composite step (loop/for_each/parallel) or on a member of another step's
// parallel fan-out, because gate routing is only wired into the sequential
// driver; those static guards are ported here as well.
//
// Comparison contract is the `code` set (the Go layer uses a single
// ErrFlowValidation error class with distinct messages; the stable codes below
// are this validator's parity surface).

import type { Flow, NextLogicDefinition, QualityGateDefinition, StepDefinition } from '../types.js';
import { QUALITY_GATE } from '../spec/index.js';
import { Issues, isNumber, isRecord, isString } from './util.js';

const ON_FAIL_GOTO = 'goto';

function isCompositeStep(step: StepDefinition): boolean {
  const next = step.next as NextLogicDefinition | undefined;
  return (
    isRecord(step.loop) || isRecord(step.for_each) || (isRecord(next) && isRecord(next.parallel))
  );
}

/** Step IDs that appear in some OTHER step's `next.parallel.steps` fan-out. */
function parallelMembers(steps: Record<string, unknown>): Map<string, string> {
  const members = new Map<string, string>();
  for (const [ownerID, rawStep] of Object.entries(steps)) {
    if (!isRecord(rawStep)) continue;
    const next = (rawStep as StepDefinition).next as NextLogicDefinition | undefined;
    const list = isRecord(next) && isRecord(next.parallel) ? next.parallel.steps : undefined;
    if (!Array.isArray(list)) continue;
    for (const memberID of list) {
      if (isString(memberID) && !members.has(memberID)) members.set(memberID, ownerID);
    }
  }
  return members;
}

function validateGate(
  gate: QualityGateDefinition,
  stepID: string,
  step: StepDefinition,
  steps: Record<string, unknown>,
  members: Map<string, string>,
  issues: Issues,
): void {
  const field = `steps.${stepID}.quality_gate`;

  // rubric — required, non-empty.
  if (!isString(gate.rubric) || gate.rubric.trim() === '') {
    issues.error({
      field: `${field}.rubric`,
      message: `quality_gate on step '${stepID}' requires a non-empty 'rubric'`,
      code: 'quality_gate_missing_rubric',
      stepId: stepID,
    });
  }

  // threshold — when set, must be in [0,1].
  if (gate.threshold !== undefined) {
    if (
      !isNumber(gate.threshold) ||
      gate.threshold < QUALITY_GATE.thresholdMin ||
      gate.threshold > QUALITY_GATE.thresholdMax
    ) {
      issues.error({
        field: `${field}.threshold`,
        message: `quality_gate on step '${stepID}' has threshold ${String(gate.threshold)} out of range [${QUALITY_GATE.thresholdMin},${QUALITY_GATE.thresholdMax}]`,
        code: 'quality_gate_threshold_out_of_range',
        stepId: stepID,
      });
    }
  }

  // on_fail — optional; when set must be a supported action.
  const onFail = gate.on_fail;
  if (isString(onFail) && onFail !== '') {
    if (QUALITY_GATE.onFailRejected.has(onFail)) {
      // Present in the Go enum but not yet supported (e.g. `human`).
      issues.error({
        field: `${field}.on_fail`,
        message: `quality_gate on step '${stepID}' uses on_fail='${onFail}', which is not yet supported; use one of: ${[...QUALITY_GATE.onFailActions].join(', ')}`,
        code: 'quality_gate_on_fail_unsupported',
        stepId: stepID,
      });
    } else if (!QUALITY_GATE.onFailActions.has(onFail)) {
      issues.error({
        field: `${field}.on_fail`,
        message: `quality_gate on step '${stepID}' has invalid on_fail '${onFail}'`,
        code: 'quality_gate_invalid_on_fail',
        stepId: stepID,
        suggestion: `Use one of: ${[...QUALITY_GATE.onFailActions].join(', ')}`,
      });
    }
  }

  // goto_step — required + must resolve when on_fail=goto, and not be a self-goto.
  if (onFail === ON_FAIL_GOTO) {
    const goto = gate.goto_step;
    if (!isString(goto) || goto === '') {
      issues.error({
        field: `${field}.goto_step`,
        message: `quality_gate on step '${stepID}' uses on_fail=goto but goto_step is empty`,
        code: 'quality_gate_goto_missing',
        stepId: stepID,
      });
    } else if (!(goto in steps)) {
      issues.error({
        field: `${field}.goto_step`,
        message: `quality_gate on step '${stepID}' goto_step '${goto}' does not name an existing step`,
        code: 'step_not_found',
        stepId: stepID,
      });
    } else if (goto === stepID) {
      issues.error({
        field: `${field}.goto_step`,
        message: `quality_gate on step '${stepID}' uses on_fail=goto pointing at itself; a failing self-goto loops forever (use on_fail=retry with max_retries)`,
        code: 'quality_gate_goto_self',
        stepId: stepID,
      });
    }
  }

  // Composite / parallel-member scope guards.
  if (isCompositeStep(step)) {
    issues.error({
      field,
      message: `quality_gate on step '${stepID}' is not supported on loop/for_each/parallel steps`,
      code: 'quality_gate_on_composite',
      stepId: stepID,
    });
  }
  const owner = members.get(stepID);
  if (owner !== undefined) {
    issues.error({
      field,
      message: `quality_gate on step '${stepID}' is not supported because it is a parallel member of step '${owner}'`,
      code: 'quality_gate_on_parallel_member',
      stepId: stepID,
    });
  }
}

export function validateQualityGates(flow: Flow, issues: Issues): void {
  const steps = flow.steps;
  if (!isRecord(steps)) return;
  const members = parallelMembers(steps);

  for (const [stepID, rawStep] of Object.entries(steps)) {
    if (!isRecord(rawStep)) continue;
    const step = rawStep as StepDefinition;
    if (!isRecord(step.quality_gate)) continue;
    validateGate(step.quality_gate as QualityGateDefinition, stepID, step, steps, members, issues);
  }
}
