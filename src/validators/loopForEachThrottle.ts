// `loop`, `for_each`, and `throttle` structural validation.
//
// Mirrors `validateLoop`, `validateForEach`, and `validateThrottle`
// (parser.go).

import type { ForEachDefinition, LoopDefinition, ThrottleDefinition } from '../types.js';
import type { Flow } from '../types.js';
import { FOR_EACH_RESOLUTIONS, LOOP_MAX_ITERATIONS_LIMIT } from '../spec/index.js';
import { Issues, isInteger, isRecord, isString, parseGoDuration } from './util.js';

// Throttle ceilings (Go: FOR_EACH_MAX_THROTTLE_DELAY = 5m, FOR_EACH_MAX_BATCH_DELAY = 30m), in nanoseconds.
const MAX_THROTTLE_DELAY_NS = 5 * 60 * 1e9;
const MAX_BATCH_DELAY_NS = 30 * 60 * 1e9;

const RESERVED_STEP_ID_CHAR = '.';

function validateThrottle(
  throttle: ThrottleDefinition,
  field: string,
  stepID: string,
  issues: Issues,
): void {
  if (isString(throttle.delay) && throttle.delay !== '') {
    const ns = parseGoDuration(throttle.delay);
    if (ns === null) {
      issues.error({
        field: `${field}.delay`,
        message: `Invalid throttle delay '${throttle.delay}'`,
        code: 'invalid_duration',
        stepId: stepID,
      });
    } else if (ns > MAX_THROTTLE_DELAY_NS) {
      issues.error({
        field: `${field}.delay`,
        message: `throttle delay '${throttle.delay}' exceeds the 5m maximum`,
        code: 'throttle_delay_exceeds_max',
        stepId: stepID,
      });
    }
  }

  const batchSize = throttle.batch_size;
  const hasBatchDelay = isString(throttle.batch_delay) && throttle.batch_delay !== '';
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
    const ns = parseGoDuration(throttle.batch_delay as string);
    if (ns === null) {
      issues.error({
        field: `${field}.batch_delay`,
        message: `Invalid throttle batch_delay '${throttle.batch_delay}'`,
        code: 'invalid_duration',
        stepId: stepID,
      });
    } else if (ns > MAX_BATCH_DELAY_NS) {
      issues.error({
        field: `${field}.batch_delay`,
        message: `throttle batch_delay '${throttle.batch_delay}' exceeds the 30m maximum`,
        code: 'throttle_batch_delay_exceeds_max',
        stepId: stepID,
      });
    }
  }
}

function validateForEach(step: Record<string, unknown>, stepID: string, issues: Issues): void {
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
    validateThrottle(fe.throttle as ThrottleDefinition, `${base}.throttle`, stepID, issues);
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

export function validateLoopForEachThrottle(flow: Flow, issues: Issues): void {
  const steps = flow.steps;
  if (!isRecord(steps)) return;

  for (const [stepID, step] of Object.entries(steps)) {
    if (!isRecord(step)) continue;
    if (step.for_each !== undefined && step.for_each !== null && isRecord(step.for_each)) {
      validateForEach(step, stepID, issues);
    }
    if (step.loop !== undefined && step.loop !== null && isRecord(step.loop)) {
      validateLoop(step, stepID, issues);
    }
  }
}
