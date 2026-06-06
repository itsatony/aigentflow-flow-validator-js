// Required top-level fields, step-map shape, per-step executor requirement,
// and the reserved-character rule on step IDs.
//
// Mirrors `validateBasicStructure` (validation.go) and the structural head of
// `FlowParser.ValidateFlow` (parser.go). Because YAML can produce any shape,
// this module also emits `invalid_type` errors where the Go struct decoder
// would have failed at unmarshal time.

import type { Flow } from '../types.js';
import { Issues, isRecord, isString, stepNames } from './util.js';

// Reserved in step IDs: the engine uses "parent.child" as the composite ID for
// loop sub-steps, so a literal "." in a top-level step ID is rejected.
const RESERVED_STEP_ID_CHAR = '.';

export function validateBasicStructure(flow: Flow, issues: Issues): void {
  if (!isString(flow.aigentflow_version) || flow.aigentflow_version === '') {
    issues.error({
      field: 'aigentflow_version',
      message: 'AIgentFlow version is required',
      code: 'missing_required_field',
      suggestion: 'Add \'aigentflow_version: "2.0.0"\' to your flow',
    });
  }

  if (!isString(flow.name) || flow.name === '') {
    issues.error({
      field: 'name',
      message: 'Flow name is required',
      code: 'missing_required_field',
      suggestion: 'Add a descriptive name to your flow',
    });
  }

  if (!isString(flow.start) || flow.start === '') {
    issues.error({
      field: 'start',
      message: 'Start step is required',
      code: 'missing_required_field',
      suggestion: 'Specify which step should execute first',
    });
  }

  const steps = flow.steps;
  if (steps === undefined || steps === null) {
    issues.error({
      field: 'steps',
      message: 'At least one step is required',
      code: 'missing_required_field',
      suggestion: 'Define steps for your workflow',
    });
    return;
  }
  if (!isRecord(steps)) {
    issues.error({
      field: 'steps',
      message: 'steps must be a mapping of step ID to step definition',
      code: 'invalid_type',
    });
    return;
  }
  if (Object.keys(steps).length === 0) {
    issues.error({
      field: 'steps',
      message: 'At least one step is required',
      code: 'missing_required_field',
      suggestion: 'Define steps for your workflow',
    });
    return;
  }

  const names = stepNames(steps);

  // Start step must exist.
  if (isString(flow.start) && flow.start !== '' && !(flow.start in steps)) {
    issues.error({
      field: 'start',
      message: `Start step '${flow.start}' not found in steps`,
      code: 'step_not_found',
      context: `Available steps: ${names.join(', ')}`,
      suggestion: `Change start to one of: ${names.join(', ')}`,
    });
  }

  // Per-step structure.
  for (const [stepID, step] of Object.entries(steps)) {
    if (stepID.includes(RESERVED_STEP_ID_CHAR)) {
      issues.error({
        field: `steps.${stepID}`,
        message: `Step ID '${stepID}' must not contain '${RESERVED_STEP_ID_CHAR}' (reserved for loop sub-step IDs)`,
        code: 'reserved_step_id_char',
        stepId: stepID,
      });
    }

    if (!isRecord(step)) {
      issues.error({
        field: `steps.${stepID}`,
        message: `Step '${stepID}' must be a mapping`,
        code: 'invalid_type',
        stepId: stepID,
      });
      continue;
    }

    // Loop steps define sub-steps instead of an executor.
    const hasLoop = step.loop !== undefined && step.loop !== null;
    const executor = step.executor;
    if (!hasLoop) {
      if (executor === undefined || executor === null || executor === '') {
        issues.error({
          field: `steps.${stepID}.executor`,
          message: 'Executor is required for each step',
          code: 'missing_required_field',
          stepId: stepID,
          suggestion: "Specify an executor URL (e.g., 'function://demo/processor')",
        });
      } else if (!isString(executor)) {
        issues.error({
          field: `steps.${stepID}.executor`,
          message: 'Executor must be a string URL',
          code: 'invalid_type',
          stepId: stepID,
        });
      }
    }
  }
}
