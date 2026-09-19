// Shape of a pre/post-processing operation: is the operation type one the
// engine dispatches, and does the operation's handler read the config keys it
// was given?
//
// Mirrors `validateProcessingOperationShape` (validation.go). Both verdicts are
// WARNINGS in the reference and here: a flow carrying either mistake saves and
// runs. That is the whole reason the rule is worth having — an operation type
// the engine cannot dispatch fails at run time with "unsupported operation
// type", and a config key the handler never reads is simply ignored, so a
// `transformation:` written where the handler reads `transformer:` produces a
// step that succeeds and does nothing.
//
// This module also owns the ONE enumeration of processing operations, which
// `templates.ts` shares — the two rules disagree about nothing structural, and
// a second walk would be a second place for the guard key to be mishandled.

import type { Flow, StepDefinition, ValidationIssue } from '../types.js';
import { PROCESSING_OPERATIONS, processingOperationConfigKeys } from '../spec/index.js';
import { Issues, isArray, isRecord } from './util.js';

/** The optional guard key on a processing operation; every other key names the operation. */
export const PROCESSING_OP_GUARD_KEY = PROCESSING_OPERATIONS.guardKey;

/** The two phases a processing operation can be declared in, in execution order. */
const PROCESSING_PHASES = ['pre_processing', 'post_processing'] as const;

/**
 * One entry of a `pre_processing:` / `post_processing:` list, decomposed the way
 * the reference's custom unmarshaller decomposes it.
 *
 * A processing operation is written as a single-key map — `- data.set: { … }` —
 * plus an optional `if:` guard. `ProcessingOperationDefinition` unmarshals that
 * key into `OperationType` and its body into an INLINE `Config`, which is why
 * the operation name is NOT a path segment in any finding: the reference
 * addresses `steps.<id>.post_processing[0].<configKey>`.
 */
export interface ProcessingOperationRef {
  stepId: string;
  /** `steps.<id>.post_processing[0]` — the operation itself. */
  basePath: string;
  /** The raw list entry, for callers that must handle a non-map entry. */
  raw: unknown;
  /** The `if:` guard value when the entry carries one. */
  guard?: unknown;
  /**
   * Every non-guard key of the entry, as written. The reference refuses a map
   * with more than one such key at unmarshal time; this validator has no typed
   * unmarshal, so it carries them all and each rule decides what it can say.
   */
  entries: Array<readonly [string, unknown]>;
}

/** Decompose both processing phases of one step, in declaration order. */
export function processingOperationsOfStep(
  stepId: string,
  step: StepDefinition,
): ProcessingOperationRef[] {
  const refs: ProcessingOperationRef[] = [];
  for (const phase of PROCESSING_PHASES) {
    const ops = (step as Record<string, unknown>)[phase];
    if (!isArray(ops)) continue;
    ops.forEach((op, i) => {
      const basePath = `steps.${stepId}.${phase}[${i}]`;
      if (!isRecord(op)) {
        refs.push({ stepId, basePath, raw: op, entries: [] });
        return;
      }
      const ref: ProcessingOperationRef = { stepId, basePath, raw: op, entries: [] };
      for (const [key, value] of Object.entries(op)) {
        if (key === PROCESSING_OP_GUARD_KEY) {
          ref.guard = value;
          continue;
        }
        ref.entries.push([key, value] as const);
      }
      refs.push(ref);
    });
  }
  return refs;
}

function unknownOperationIssue(
  ref: ProcessingOperationRef,
  operationType: string,
): Omit<ValidationIssue, 'severity'> {
  const known = [...PROCESSING_OPERATIONS.standardTypes].sort().join(', ');
  return {
    // The operation type is the YAML MAP KEY (`- data.set: {…}`), not a field.
    // Addressing a `.operation_type` here would send the author looking for
    // something the grammar does not have, so the finding points at the
    // operation itself.
    field: ref.basePath,
    message:
      `Processing operation type '${operationType}' is not dispatched by the engine; ` +
      'at run time the step fails with "unsupported operation type" unless the ' +
      "operation's `if:` guard is false",
    code: 'unknown_processing_operation',
    stepId: ref.stepId,
    suggestion: `Operation types the engine dispatches here: ${known}`,
  };
}

/**
 * Warn about an operation type the standard handler cannot dispatch and about a
 * config key its handler never reads.
 *
 * Scope is the standard (top-level step) handler, because this validator walks
 * `flow.steps` and a loop body is a second step table it does not reach. So
 * `loop.set` / `loop.break` at the top level are correctly unknown here.
 */
export function validateProcessingOperations(flow: Flow, issues: Issues): void {
  const steps = flow.steps;
  if (!isRecord(steps)) return;

  for (const [stepId, rawStep] of Object.entries(steps)) {
    if (!isRecord(rawStep)) continue;
    for (const ref of processingOperationsOfStep(stepId, rawStep as StepDefinition)) {
      // The reference refuses an entry that is not a one-key map outright, at
      // unmarshal time. There is no operation to have an opinion about here, so
      // this rule says nothing and leaves the verdict to the structural pass.
      if (ref.entries.length !== 1) continue;
      const [operationType, config] = ref.entries[0] as readonly [string, unknown];

      if (!PROCESSING_OPERATIONS.standardTypes.has(operationType)) {
        issues.warn(unknownOperationIssue(ref, operationType));
        // An unknown type has no key set, so every key under it would warn a
        // second time for the same one mistake. One verdict per defect.
        continue;
      }

      const [allowed, closed] = processingOperationConfigKeys(operationType);
      // Not closed: the author names the keys (`data.set` writes each one into
      // `.data`, and so on). There is no unknown key to find.
      if (!closed) continue;
      // The reference requires the config to be a mapping and fails to unmarshal
      // otherwise; a non-map config is not a key question.
      if (!isRecord(config)) continue;

      const permitted = new Set(allowed);
      const readable = [...allowed].sort().join(', ');
      // Sorted so one flow's verdicts keep a stable order between runs.
      for (const key of Object.keys(config).sort()) {
        if (permitted.has(key)) continue;
        issues.warn({
          field: `${ref.basePath}.${key}`,
          message:
            `Operation '${operationType}' does not read the config key '${key}', ` +
            'so it is silently ignored at run time',
          code: 'unknown_processing_config_key',
          stepId: ref.stepId,
          suggestion: `'${operationType}' reads: ${readable}`,
        });
      }
    }
  }
}
