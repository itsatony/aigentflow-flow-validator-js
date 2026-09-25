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
  /** Which handler will dispatch this operation — the dispatch set differs. */
  scope: ProcessingOperationScope;
}

/**
 * WHERE a processing operation is declared, because the dispatch set is not the
 * same in both places.
 *
 * `standard` is the top-level handler. `loopSubStep` is `executeLoopPostProcessing`,
 * which dispatches `loop.set` / `loop.break` ITSELF and falls through to the
 * standard handler for everything else — a strict superset. ⛔ The two are a
 * PARTITION and never a union: `loop.set` at the top level is an operation the
 * standard handler cannot dispatch, and saying otherwise would silently accept a
 * flow that fails at run time.
 */
export type ProcessingOperationScope = 'standard' | 'loopSubStep';

/** The operation types dispatchable in a scope. */
export function dispatchableOperationTypes(scope: ProcessingOperationScope): ReadonlySet<string> {
  if (scope === 'standard') return PROCESSING_OPERATIONS.standardTypes;
  return new Set([
    ...PROCESSING_OPERATIONS.standardTypes,
    ...PROCESSING_OPERATIONS.loopSubStepTypes,
  ]);
}

/** Decompose both processing phases of one step, in declaration order. */
export function processingOperationsOfStep(
  stepId: string,
  step: StepDefinition,
): ProcessingOperationRef[] {
  return decomposePhases(stepId, step as Record<string, unknown>, `steps.${stepId}`, 'standard');
}

/**
 * Decompose the processing operations of every sub-step of a `loop:` step.
 *
 * ⛔ The reference's `validateStepsInOrder` walks `flow.steps`, and a loop body
 * is a SECOND step table — so until v2.648.0 no template and no operation shape
 * inside a loop sub-step had been looked at by either implementation. This
 * validator inherited the same blind spot, recorded in PARITY.md as a scope note
 * rather than a divergence. DC-FORGE-78 closed it on both sides.
 *
 * Findings are attributed to the PARENT step id, because that is the id every
 * other surface knows this work by; the sub-step is named by its INDEX in the
 * field path, matching the reference's `steps.<id>.loop.steps[i]…`.
 */
export function loopSubStepProcessingOperations(
  stepId: string,
  step: StepDefinition,
): ProcessingOperationRef[] {
  const refs: ProcessingOperationRef[] = [];
  for (const sub of loopSubStepsOfStep(stepId, step)) {
    refs.push(...decomposePhases(stepId, sub.raw, sub.basePath, 'loopSubStep'));
  }
  return refs;
}

/** One sub-step of a `loop:` body, with the field path the reference addresses it by. */
export interface LoopSubStepRef {
  /** `steps.<parent>.loop.steps[i]` */
  basePath: string;
  raw: Record<string, unknown>;
}

/** Enumerate a loop step's sub-steps. Empty for a step with no `loop:` block. */
export function loopSubStepsOfStep(stepId: string, step: StepDefinition): LoopSubStepRef[] {
  const loop = (step as Record<string, unknown>).loop;
  if (!isRecord(loop)) return [];
  const subSteps = (loop as Record<string, unknown>).steps;
  if (!isArray(subSteps)) return [];
  const refs: LoopSubStepRef[] = [];
  subSteps.forEach((sub, i) => {
    if (!isRecord(sub)) return;
    refs.push({
      basePath: `steps.${stepId}.loop.steps[${i}]`,
      raw: sub as Record<string, unknown>,
    });
  });
  return refs;
}

function decomposePhases(
  stepId: string,
  container: Record<string, unknown>,
  pathPrefix: string,
  scope: ProcessingOperationScope,
): ProcessingOperationRef[] {
  const refs: ProcessingOperationRef[] = [];
  for (const phase of PROCESSING_PHASES) {
    const ops = container[phase];
    if (!isArray(ops)) continue;
    ops.forEach((op, i) => {
      const basePath = `${pathPrefix}.${phase}[${i}]`;
      if (!isRecord(op)) {
        refs.push({ stepId, basePath, raw: op, entries: [], scope });
        return;
      }
      const ref: ProcessingOperationRef = { stepId, basePath, raw: op, entries: [], scope };
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
  const known = [...dispatchableOperationTypes(ref.scope)].sort().join(', ');
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
 * Both scopes are walked (DC-FORGE-78): the top-level steps, where `loop.set` /
 * `loop.break` are correctly UNKNOWN because the standard handler has no case for
 * them, and every `loop:` body, where they are dispatchable. ⛔ Merging the two
 * sets would accept `loop.set` at the top level, which fails at run time.
 */
export function validateProcessingOperations(flow: Flow, issues: Issues): void {
  const steps = flow.steps;
  if (!isRecord(steps)) return;

  for (const [stepId, rawStep] of Object.entries(steps)) {
    if (!isRecord(rawStep)) continue;
    const step = rawStep as StepDefinition;
    for (const ref of [
      ...processingOperationsOfStep(stepId, step),
      ...loopSubStepProcessingOperations(stepId, step),
    ]) {
      // The reference refuses an entry that is not a one-key map outright, at
      // unmarshal time. There is no operation to have an opinion about here, so
      // this rule says nothing and leaves the verdict to the structural pass.
      if (ref.entries.length !== 1) continue;
      const [operationType, config] = ref.entries[0] as readonly [string, unknown];

      if (!dispatchableOperationTypes(ref.scope).has(operationType)) {
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
