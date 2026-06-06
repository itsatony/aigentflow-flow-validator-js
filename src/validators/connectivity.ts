// Step connectivity: `next` reference existence (errors), unreachable steps
// (warnings), and cycle detection (warning).
//
// Mirrors `validateStepConnectivity` + `checkForCycles` + `findReachableSteps`
// (validation.go). Reachability and cycles follow only `next.default` and
// `next.conditions[].goto_step`, exempting the terminal markers null / end /
// orchestrator — exactly as the reference does.

import type { Flow, NextCondition, NextLogicDefinition } from '../types.js';
import { NEXT_MARKERS } from '../spec/index.js';
import { Issues, isRecord, isString, stepNames } from './util.js';

function isMarker(target: string): boolean {
  return NEXT_MARKERS.has(target);
}

function gotoTargets(next: NextLogicDefinition): string[] {
  const out: string[] = [];
  if (isString(next.default) && next.default !== '' && !isMarker(next.default)) {
    out.push(next.default);
  }
  if (Array.isArray(next.conditions)) {
    for (const cond of next.conditions as NextCondition[]) {
      if (
        isRecord(cond) &&
        isString(cond.goto_step) &&
        cond.goto_step !== '' &&
        !isMarker(cond.goto_step)
      ) {
        out.push(cond.goto_step);
      }
    }
  }
  return out;
}

export function validateConnectivity(flow: Flow, issues: Issues): void {
  const steps = flow.steps;
  if (!isRecord(steps)) return;
  const names = stepNames(steps);
  const available = new Set(names);

  // Reference existence.
  for (const [stepID, step] of Object.entries(steps)) {
    if (!isRecord(step)) continue;
    const next = step.next;
    if (!isRecord(next)) continue;
    const n = next as NextLogicDefinition;

    if (
      isString(n.default) &&
      n.default !== '' &&
      !isMarker(n.default) &&
      !available.has(n.default)
    ) {
      issues.error({
        field: `steps.${stepID}.next.default`,
        message: `Referenced step '${n.default}' does not exist`,
        code: 'step_not_found',
        stepId: stepID,
        context: `Available steps: ${names.join(', ')}`,
        suggestion: `Change to one of: ${names.join(', ')}`,
      });
    }

    if (Array.isArray(n.conditions)) {
      n.conditions.forEach((cond: unknown, i: number) => {
        if (!isRecord(cond)) return;
        const goto = (cond as NextCondition).goto_step;
        if (isString(goto) && goto !== '' && !isMarker(goto) && !available.has(goto)) {
          issues.error({
            field: `steps.${stepID}.next.conditions[${i}].goto`,
            message: `Referenced step '${goto}' does not exist`,
            code: 'step_not_found',
            stepId: stepID,
            context: `Available steps: ${names.join(', ')}`,
            suggestion: `Change to one of: ${names.join(', ')}`,
          });
        }
      });
    }
  }

  const start = isString(flow.start) ? flow.start : '';
  if (start === '' || !available.has(start)) {
    // Without a valid start, reachability/cycle analysis is meaningless and
    // the missing-start error is already reported elsewhere.
    return;
  }

  // Reachability (BFS from start).
  const reachable = new Set<string>();
  const queue: string[] = [start];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    if (reachable.has(current)) continue;
    reachable.add(current);
    const step = steps[current];
    if (isRecord(step) && isRecord(step.next)) {
      for (const target of gotoTargets(step.next as NextLogicDefinition)) {
        if (!reachable.has(target)) queue.push(target);
      }
    }
  }
  for (const stepID of names) {
    if (!reachable.has(stepID)) {
      issues.warn({
        field: `steps.${stepID}`,
        message: `Step '${stepID}' is not reachable from start step`,
        code: 'unreachable_step',
        stepId: stepID,
        suggestion: 'Add a path to this step or remove it if not needed',
      });
    }
  }

  // Cycle detection (DFS with recursion stack).
  const visited = new Set<string>();
  const recStack = new Set<string>();
  const hasCycle = (stepID: string): boolean => {
    if (recStack.has(stepID)) return true;
    if (visited.has(stepID)) return false;
    visited.add(stepID);
    recStack.add(stepID);
    const step = steps[stepID];
    if (isRecord(step) && isRecord(step.next)) {
      for (const target of gotoTargets(step.next as NextLogicDefinition)) {
        if (hasCycle(target)) return true;
      }
    }
    recStack.delete(stepID);
    return false;
  };
  if (hasCycle(start)) {
    issues.warn({
      field: 'steps',
      message: 'Potential infinite loop detected in step flow',
      code: 'potential_infinite_loop',
      suggestion: 'Review your step transitions to ensure they eventually terminate',
    });
  }
}
