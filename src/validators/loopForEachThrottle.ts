// `loop`, `for_each`, and `throttle` structural validation.
//
// Mirrors `validateLoop`, `validateForEach`, and `validateThrottle`
// (parser.go).

import type {
  ForEachDefinition,
  LoopDefinition,
  NextCondition,
  NextLogicDefinition,
  ThrottleDefinition,
} from '../types.js';
import type { Flow } from '../types.js';
import { FOR_EACH_RESOLUTIONS, LOOP_MAX_ITERATIONS_LIMIT } from '../spec/index.js';
import {
  Issues,
  isInteger,
  isRecord,
  isString,
  parseGoDuration,
  scalarTextAt,
  type ScalarSources,
} from './util.js';

// Throttle ceilings (Go: FOR_EACH_MAX_THROTTLE_DELAY = 5m, FOR_EACH_MAX_BATCH_DELAY = 30m), in nanoseconds.
const MAX_THROTTLE_DELAY_NS = 5 * 60 * 1e9;
const MAX_BATCH_DELAY_NS = 30 * 60 * 1e9;

const RESERVED_STEP_ID_CHAR = '.';

/**
 * The loop result's own summary fields (reference: `LoopResultSummaryFields`,
 * AIF v2.648.0 / DC-FORGE-78). The loop step's committed result carries these
 * AND one entry per sub-step under its id, so a sub-step named `vars` is
 * unreadable through `{{ .data.<loop>.vars }}` — the summary field wins.
 */
const LOOP_RESULT_SUMMARY_FIELDS: readonly string[] = [
  'iterations',
  'break',
  'vars',
  'duration_ms',
];

/**
 * The two top-level `next:` sentinels. Neither carries any meaning inside a
 * loop body: the reference's `resolveLoopSubStepNext` has no sentinel awareness
 * at all, so `null` cannot end a mission from there and `orchestrator` cannot
 * yield — both take the same "no such sub-step" miss path as a plain typo.
 *
 * `end` is deliberately NOT listed. The reference refuses only these two by
 * name and lets everything else fall through to the target-existence check, and
 * that is the honest answer here too: `end` names no sub-step of the loop, so it
 * is reported as a missing target rather than as a reserved marker. Divergence
 * #2 ("`end` is always terminal") is about TOP-LEVEL next targets and is not
 * extended into a loop body, where nothing reads it.
 */
const LOOP_SUBSTEP_NEXT_SENTINELS = new Set(['null', 'orchestrator']);

/**
 * One loop sub-step's `next:` block, checked against the LOOP's own sub-step
 * table and nothing else (reference: `validateLoopSubStepNext`, parser.go,
 * AIF v2.672.0 / DC-FORGE-102, aigentflow#116).
 *
 * A loop body is a SECOND step table. `validateNextLogic` and the connectivity
 * pass walk `flow.steps` only, so before this rule existed a sub-step could
 * route to `pol` when the sub-step is called `poll` and nothing said a word:
 * the reference stored the flow and the loop driver WARNed at run time and
 * advanced sequentially — the branch the author wrote simply never happened, in
 * the one construct whose entire purpose is branching.
 *
 * Both jump directions are legal (the runtime index covers every sub-step, not
 * only the ones declared earlier), and an EMPTY target is the documented
 * "advance sequentially" and must stay legal — which is why this runs as a
 * second pass over the already-collected id set.
 */
function validateLoopSubStepNext(
  sub: Record<string, unknown>,
  subStepIDs: Set<string>,
  base: string,
  index: number,
  stepID: string,
  issues: Issues,
): void {
  const next = sub.next;
  if (next === undefined || next === null) return;
  const path = `${base}.steps[${index}].next`;
  const subStepID = isString(sub.id) ? sub.id : `[${index}]`;
  if (!isRecord(next)) {
    issues.error({
      field: path,
      message: `loop sub-step '${subStepID}' next must be a mapping`,
      code: 'invalid_type',
      stepId: stepID,
    });
    return;
  }
  const n = next as NextLogicDefinition;

  // The loop driver reads conditions and default only, so a parallel block here
  // never fans out and its rendezvous never runs. The reference returns on this
  // one without looking at the targets; so do we.
  if (isRecord(n.parallel)) {
    issues.error({
      field: `${path}.parallel`,
      message: `loop sub-step '${subStepID}' declares next.parallel, which a loop body does not support (sub-steps run sequentially)`,
      code: 'loop_substep_next_parallel',
      stepId: stepID,
      suggestion:
        'Use next.conditions/default to branch within the iteration, or a top-level step for parallel fan-out',
    });
    return;
  }

  const targets: { field: string; value: unknown }[] = [
    { field: `${path}.default`, value: n.default },
  ];
  if (Array.isArray(n.conditions)) {
    (n.conditions as NextCondition[]).forEach((condition, j) => {
      if (!isRecord(condition)) return;
      targets.push({ field: `${path}.conditions[${j}].goto`, value: condition.goto });
    });
  }

  for (const target of targets) {
    if (target.value === undefined || target.value === null) continue;
    if (!isString(target.value)) {
      issues.error({
        field: target.field,
        message: `loop sub-step '${subStepID}' next target must be a string`,
        code: 'invalid_type',
        stepId: stepID,
      });
      continue;
    }
    // Empty is the documented sequential advance.
    if (target.value === '') continue;
    if (LOOP_SUBSTEP_NEXT_SENTINELS.has(target.value)) {
      issues.error({
        field: target.field,
        message: `loop sub-step '${subStepID}' routes next to the reserved marker '${target.value}', which has no meaning inside a loop body`,
        code: 'loop_substep_next_sentinel',
        stepId: stepID,
        suggestion:
          'Name another sub-step of the same loop, or leave the target empty for sequential advance',
      });
      continue;
    }
    if (!subStepIDs.has(target.value)) {
      issues.error({
        field: target.field,
        message: `loop sub-step '${subStepID}' routes next to '${target.value}', which is not a sub-step of that loop`,
        code: 'loop_substep_next_target_not_found',
        stepId: stepID,
        suggestion:
          subStepIDs.size > 0
            ? `A sub-step's next: resolves only against loop.steps of the SAME loop. Available: ${[...subStepIDs].sort().join(', ')}`
            : "A sub-step's next: resolves only against loop.steps of the SAME loop",
      });
    }
  }
}

function validateThrottle(
  throttle: ThrottleDefinition,
  field: string,
  stepID: string,
  issues: Issues,
  sources: ScalarSources | undefined,
): void {
  // Both delays are Go `string` fields, which yaml.v3 fills from ANY scalar by
  // its source text: `delay: 100` is "100" (no unit, refused), `delay: 0` is
  // "0" (saves) and `delay: 0.0` is "0.0" (refused). A number used to be
  // skipped here, which accepted all three.
  const delay = scalarTextAt(throttle.delay, `${field}.delay`, sources);
  if (delay !== null && delay !== '') {
    const ns = parseGoDuration(delay);
    if (ns === null) {
      issues.error({
        field: `${field}.delay`,
        message: `Invalid throttle delay '${delay}'`,
        code: 'invalid_duration',
        stepId: stepID,
      });
    } else if (ns > MAX_THROTTLE_DELAY_NS) {
      issues.error({
        field: `${field}.delay`,
        message: `throttle delay '${delay}' exceeds the 5m maximum`,
        code: 'throttle_delay_exceeds_max',
        stepId: stepID,
      });
    }
  }

  const batchSize = throttle.batch_size;
  const batchDelay = scalarTextAt(throttle.batch_delay, `${field}.batch_delay`, sources);
  const hasBatchDelay = batchDelay !== null && batchDelay !== '';
  if (batchSize !== undefined && isInteger(batchSize) && batchSize < 0) {
    issues.error({
      field: `${field}.batch_size`,
      message: `throttle batch_size must be >= 0, got ${batchSize}`,
      code: 'throttle_invalid_batch_size',
      stepId: stepID,
    });
  } else if ((batchSize === undefined || batchSize === 0) && hasBatchDelay) {
    issues.error({
      field: `${field}.batch_delay`,
      message: 'throttle batch_delay requires a batch_size',
      code: 'throttle_batch_delay_without_size',
      stepId: stepID,
    });
  }

  if (hasBatchDelay) {
    const ns = parseGoDuration(batchDelay as string);
    if (ns === null) {
      issues.error({
        field: `${field}.batch_delay`,
        message: `Invalid throttle batch_delay '${batchDelay}'`,
        code: 'invalid_duration',
        stepId: stepID,
      });
    } else if (ns > MAX_BATCH_DELAY_NS) {
      issues.error({
        field: `${field}.batch_delay`,
        message: `throttle batch_delay '${batchDelay}' exceeds the 30m maximum`,
        code: 'throttle_batch_delay_exceeds_max',
        stepId: stepID,
      });
    }
  }
}

function validateForEach(
  step: Record<string, unknown>,
  stepID: string,
  issues: Issues,
  sources: ScalarSources | undefined,
): void {
  const fe = step.for_each as ForEachDefinition;
  const base = `steps.${stepID}.for_each`;

  if (!isString(fe.items) || fe.items === '') {
    issues.error({
      field: `${base}.items`,
      message: 'for_each requires a non-empty items expression',
      code: 'for_each_items_required',
      stepId: stepID,
    });
  }

  const next = step.next;
  if (isRecord(next) && isRecord(next.parallel)) {
    issues.error({
      field: base,
      message: 'A step cannot use both for_each and next.parallel',
      code: 'for_each_mutual_exclusion',
      stepId: stepID,
    });
  }

  if (fe.max_parallel !== undefined && isInteger(fe.max_parallel) && fe.max_parallel < 0) {
    issues.error({
      field: `${base}.max_parallel`,
      message: `for_each max_parallel must be >= 0, got ${fe.max_parallel}`,
      code: 'for_each_invalid_max_parallel',
      stepId: stepID,
    });
  }

  if (isString(fe.resolution) && fe.resolution !== '' && !FOR_EACH_RESOLUTIONS.has(fe.resolution)) {
    issues.error({
      field: `${base}.resolution`,
      message: `Invalid for_each resolution '${fe.resolution}'`,
      code: 'for_each_invalid_resolution',
      stepId: stepID,
      suggestion: `Use one of: ${[...FOR_EACH_RESOLUTIONS].join(', ')}`,
    });
  }

  if (isRecord(fe.throttle)) {
    validateThrottle(
      fe.throttle as ThrottleDefinition,
      `${base}.throttle`,
      stepID,
      issues,
      sources,
    );
  }
}

function validateLoop(step: Record<string, unknown>, stepID: string, issues: Issues): void {
  const loop = step.loop as LoopDefinition;
  const base = `steps.${stepID}.loop`;

  if (!isString(loop.while) || loop.while === '') {
    issues.error({
      field: `${base}.while`,
      message: 'loop requires a non-empty while condition',
      code: 'loop_while_required',
      stepId: stepID,
    });
  }

  const maxIter = loop.max_iterations;
  if (maxIter === undefined || !isInteger(maxIter) || maxIter <= 0) {
    issues.error({
      field: `${base}.max_iterations`,
      message: 'loop requires max_iterations > 0',
      code: 'loop_max_iterations_required',
      stepId: stepID,
    });
  } else if (maxIter > LOOP_MAX_ITERATIONS_LIMIT) {
    issues.error({
      field: `${base}.max_iterations`,
      message: `loop max_iterations (${maxIter}) exceeds the limit of ${LOOP_MAX_ITERATIONS_LIMIT}`,
      code: 'loop_max_iterations_range',
      stepId: stepID,
    });
  }

  const subSteps = loop.steps;
  if (!Array.isArray(subSteps) || subSteps.length === 0) {
    issues.error({
      field: `${base}.steps`,
      message: 'loop requires at least one sub-step',
      code: 'loop_steps_required',
      stepId: stepID,
    });
  } else {
    const seen = new Set<string>();
    subSteps.forEach((sub: unknown, i: number) => {
      const subPath = `${base}.steps[${i}]`;
      if (!isRecord(sub)) {
        issues.error({
          field: subPath,
          message: 'loop sub-step must be a mapping',
          code: 'invalid_type',
          stepId: stepID,
        });
        return;
      }
      const id = sub.id;
      if (!isString(id) || id === '') {
        issues.error({
          field: `${subPath}.id`,
          message: `loop sub-step at index ${i} requires an 'id'`,
          code: 'loop_step_id_required',
          stepId: stepID,
        });
      } else {
        if (id.includes(RESERVED_STEP_ID_CHAR)) {
          issues.error({
            field: `${subPath}.id`,
            message: `loop sub-step id '${id}' must not contain '${RESERVED_STEP_ID_CHAR}'`,
            code: 'reserved_step_id_char',
            stepId: stepID,
          });
        }
        if (seen.has(id)) {
          issues.error({
            field: `${subPath}.id`,
            message: `Duplicate loop sub-step id '${id}'`,
            code: 'loop_step_id_duplicate',
            stepId: stepID,
          });
        }
        seen.add(id);
        // A WARNING in the reference, not an error: the sub-step still runs, and
        // its result stays reachable through the flat `index .data "<loop>.<sub>"`
        // key. The reference reports it on the `loop.steps` field and names the
        // parent step, so this does too.
        if (LOOP_RESULT_SUMMARY_FIELDS.includes(id)) {
          issues.warn({
            field: `${base}.steps`,
            message: `loop sub-step id '${id}' is also a field of the loop's own result, so {{ .data.${stepID}.${id} }} reads the loop's ${id} instead of this sub-step's output`,
            code: 'loop_sub_step_id_reserved',
            stepId: stepID,
            suggestion: `rename the sub-step; ids reserved by the loop result: ${[...LOOP_RESULT_SUMMARY_FIELDS].sort().join(', ')}`,
          });
        }
      }
      if (!isString(sub.executor) || sub.executor === '') {
        issues.error({
          field: `${subPath}.executor`,
          message: `loop sub-step at index ${i} requires an 'executor'`,
          code: 'loop_step_executor_required',
          stepId: stepID,
        });
      }
    });

    // Second pass, deliberately: a FORWARD jump is legal, so the whole id set
    // has to exist before any target can be judged.
    subSteps.forEach((sub: unknown, i: number) => {
      if (!isRecord(sub)) return;
      validateLoopSubStepNext(sub, seen, base, i, stepID, issues);
    });
  }

  if (step.for_each !== undefined && step.for_each !== null) {
    issues.error({
      field: base,
      message: 'A step cannot use both loop and for_each',
      code: 'loop_mutual_exclusion_for_each',
      stepId: stepID,
    });
  }

  if (isString(step.executor) && step.executor !== '') {
    issues.error({
      field: `steps.${stepID}.executor`,
      message: 'A loop step must not define its own executor (it defines sub-steps)',
      code: 'loop_mutual_exclusion_executor',
      stepId: stepID,
    });
  }
}

export function validateLoopForEachThrottle(
  flow: Flow,
  issues: Issues,
  sources?: ScalarSources,
): void {
  const steps = flow.steps;
  if (!isRecord(steps)) return;

  for (const [stepID, step] of Object.entries(steps)) {
    if (!isRecord(step)) continue;
    if (step.for_each !== undefined && step.for_each !== null && isRecord(step.for_each)) {
      validateForEach(step, stepID, issues, sources);
    }
    if (step.loop !== undefined && step.loop !== null && isRecord(step.loop)) {
      validateLoop(step, stepID, issues);
    }
  }
}
