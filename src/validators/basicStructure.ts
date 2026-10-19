// Required top-level fields, step-map shape, per-step executor requirement,
// and the two reserved step-ID rules (the `.` character, the id `orchestrator`).
//
// Mirrors `validateBasicStructure` (validation.go) and the structural head of
// `FlowParser.ValidateFlow` (parser.go). Because YAML can produce any shape,
// this module also emits `invalid_type` errors where the Go struct decoder
// would have failed at unmarshal time.

import type { Flow } from '../types.js';
import { Issues, isRecord, stepNames } from './util.js';

// Reserved in step IDs: the engine uses "parent.child" as the composite ID for
// loop sub-steps, so a literal "." in a top-level step ID is rejected.
const RESERVED_STEP_ID_CHAR = '.';
const RESERVED_STEP_ID_ORCHESTRATOR = 'orchestrator';

// Upper bound of the optional `display_name`, counted in Unicode code points
// (Go's utf8.RuneCountInString), never in UTF-16 units.
const DISPLAY_NAME_MAX_LEN = 80;

// The YAML 1.1 boolean spellings yaml.v3 still accepts for a Go `bool` field when
// they are written as a plain (unquoted) scalar. This port cannot tell a quoted
// scalar from a plain one, so it accepts them either way (the looser direction).
const YAML11_BOOL_WORDS: ReadonlySet<string> = new Set(
  ['y', 'yes', 'on', 'n', 'no', 'off'].flatMap((w) => [
    w,
    w.toUpperCase(),
    w[0]!.toUpperCase() + w.slice(1),
  ]),
);

/** A Go `bool` field: a boolean, a YAML null (zero value) or a YAML 1.1 word. */
function isBoolLike(v: unknown): boolean {
  if (v === null || typeof v === 'boolean') return true;
  return typeof v === 'string' && YAML11_BOOL_WORDS.has(v);
}

export function validateBasicStructure(flow: Flow, issues: Issues): void {
  if (!issues.nonEmptyStringOf(flow, 'aigentflow_version', '')) {
    issues.error({
      field: 'aigentflow_version',
      message: 'AIgentFlow version is required',
      code: 'missing_required_field',
      suggestion: 'Add \'aigentflow_version: "2.0.0"\' to your flow',
    });
  }

  if (!issues.nonEmptyStringOf(flow, 'name', '')) {
    issues.error({
      field: 'name',
      message: 'Flow name is required',
      code: 'missing_required_field',
      suggestion: 'Add a descriptive name to your flow',
    });
  }

  // Optional human-friendly label. Absent or empty is fine; only length is judged.
  const displayName = issues.stringOf(flow, 'display_name', '');
  if (displayName !== null) {
    const n = [...displayName].length;
    if (n > DISPLAY_NAME_MAX_LEN) {
      issues.error({
        field: 'display_name',
        message: `display_name is ${n} characters; the limit is ${DISPLAY_NAME_MAX_LEN}`,
        code: 'display_name_too_long',
        suggestion: "Shorten display_name; it is a label, put prose in 'description'",
      });
    }
  }

  // Optional opt-in to fail a render that reads a missing key. A Go `bool`: the
  // engine's behaviour is out of scope here, only the value's kind is judged.
  if (flow.strict_templates !== undefined && !isBoolLike(flow.strict_templates)) {
    issues.error({
      field: 'strict_templates',
      message: 'strict_templates must be a boolean (true or false)',
      code: 'invalid_type',
      suggestion: "Write 'strict_templates: true' or remove the key",
    });
  }

  // A Go `string`: `start: 1` names the step "1".
  const start = issues.stringOf(flow, 'start', '');
  if (start === null || start === '') {
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
  if (start !== null && start !== '' && !(start in steps)) {
    issues.error({
      field: 'start',
      message: `Start step '${start}' not found in steps`,
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

    // AIF v2.484.0 (DC-COND-1): `orchestrator` is the engine's own step id for
    // orchestrator-originated signals and a reserved `next:` marker. A worker
    // step with that id could have its soft completion signal read as the
    // mission-complete key. Case-sensitive, top-level steps only, as upstream.
    if (stepID === RESERVED_STEP_ID_ORCHESTRATOR) {
      issues.error({
        field: `steps.${stepID}`,
        message: `Step ID '${stepID}' is reserved (the orchestrator's signal namespace and a next: marker)`,
        code: 'reserved_step_id_orchestrator',
        stepId: stepID,
        suggestion: 'Rename the step',
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
    // A number here is the reference's executor "42" — present, and refused by
    // the URL check (executors.ts) rather than as a type error. Only a mapping
    // or a list fails to decode into the Go `string`.
    const executor = step.executor;
    const executorText = issues.stringOf(step, 'executor', `steps.${stepID}`);
    if (!hasLoop) {
      if (executor === undefined || executor === null || executorText === '') {
        issues.error({
          field: `steps.${stepID}.executor`,
          message: 'Executor is required for each step',
          code: 'missing_required_field',
          stepId: stepID,
          suggestion: "Specify an executor URL (e.g., 'function://utils/log')",
        });
      } else if (executorText === null) {
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
