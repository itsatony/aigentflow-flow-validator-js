// Step connectivity: `next` reference existence (errors), unreachable steps
// (warnings), and cycle detection (warning).
//
// Mirrors `validateStepConnectivity` + `checkForCycles` + `findReachableSteps`
// (validation.go) and the save door's `validateNextLogic` (parser.go). See the
// two marker sets below: `end` is a terminal marker for the walks only.
//
// ⚠ REACHABILITY AND CYCLES FOLLOW DIFFERENT EDGE SETS, and that is faithful,
// not an oversight. AIgentFlow v2.598.0 (DC-FORGE-30) widened `findReachableSteps`
// to the five edge kinds `collectNextTargets` yields — `next.default`,
// `next.conditions[].goto`, `next.parallel.steps[]`, `next.parallel.rendezvous`
// and the step-level `error_strategy.goto_step` — plus the FLOW-level
// `error_strategy.goto_step` seeded into the queue. It did NOT touch
// `checkForCycles`, which still walks `next.default` + `next.conditions[].goto`
// only. Widening the cycle walk too would invent a divergence: a rendezvous or an
// error redirect back to an earlier step is an ordinary shape and would start
// emitting a spurious `potential_infinite_loop`.
//
// The narrow walk was a real defect on the authoring surface: AIgentFlow's Studio
// renders `unreachable_step` with a jump-to-line, and it was telling authors that
// three working steps of a bundled flow were dead code.

import type { Flow, NextCondition, NextLogicDefinition } from '../types.js';
import { NEXT_MARKERS, REACHABILITY_TERMINAL_MARKERS } from '../spec/index.js';
import { Issues, isRecord, stepNames } from './util.js';

// TWO sets, because the reference gives two answers and both are verdicts.
//
// Existence (an ERROR) follows the save door, `validateNextLogic` (parser.go):
// only `null` and `orchestrator` stand without a step of that name, so
// `default: end` is refused when no step is called `end`.
//
// Reachability and cycles (WARNINGS) follow `findReachableSteps` /
// `checkForCycles` (validation.go), which still skip `end` as "control leaves
// the graph" — so a real step named `end` that only `end` routes to is reported
// unreachable, by the reference too.
function isSaveDoorMarker(target: string): boolean {
  return NEXT_MARKERS.has(target);
}

function isMarker(target: string): boolean {
  return REACHABILITY_TERMINAL_MARKERS.has(target);
}

/**
 * Edges the CYCLE detector follows — deliberately only two. See the header.
 * `nextPath` is the step's `steps.<id>.next`. Every reference is a Go `string`,
 * so `default: 2` is the step "2" (read through `issues.stringAt`).
 */
function cycleTargets(next: NextLogicDefinition, nextPath: string, issues: Issues): string[] {
  const out: string[] = [];
  const target = issues.stringOf(next, 'default', nextPath);
  if (target !== null && target !== '' && !isMarker(target)) out.push(target);
  if (Array.isArray(next.conditions)) {
    (next.conditions as NextCondition[]).forEach((cond, i) => {
      if (!isRecord(cond)) return;
      const goto = issues.stringOf(cond, 'goto', `${nextPath}.conditions[${i}]`);
      if (goto !== null && goto !== '' && !isMarker(goto)) out.push(goto);
    });
  }
  return out;
}

/**
 * Edges REACHABILITY follows — all five kinds `collectNextTargets` yields
 * (aigentflow.flow.simulator.go). Under-reporting here is wrong in the silent
 * direction: it turns a missing edge into a confident accusation.
 */
function reachTargets(step: Record<string, unknown>, stepID: string, issues: Issues): string[] {
  const out: string[] = [];
  const push = (target: string | null): void => {
    if (target !== null && target !== '' && !isMarker(target)) out.push(target);
  };

  if (isRecord(step.next)) {
    const next = step.next as NextLogicDefinition;
    const nextPath = `steps.${stepID}.next`;
    out.push(...cycleTargets(next, nextPath, issues));

    const parallel = (next as { parallel?: unknown }).parallel;
    if (isRecord(parallel)) {
      const parallelPath = `${nextPath}.parallel`;
      if (Array.isArray(parallel.steps)) {
        parallel.steps.forEach((id: unknown, i: number) =>
          push(issues.stringAt(id, `${parallelPath}.steps[${i}]`)),
        );
      }
      push(issues.stringOf(parallel, 'rendezvous', parallelPath));
    }
  }

  // The step-level error redirect is an edge like any other.
  const errorStrategy = step.error_strategy;
  if (isRecord(errorStrategy)) {
    push(issues.stringOf(errorStrategy, 'goto_step', `steps.${stepID}.error_strategy`));
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
    const nextPath = `steps.${stepID}.next`;

    const target = issues.stringOf(n, 'default', nextPath);
    if (target !== null && target !== '' && !isSaveDoorMarker(target) && !available.has(target)) {
      issues.error({
        field: `steps.${stepID}.next.default`,
        message: `Referenced step '${target}' does not exist`,
        code: 'step_not_found',
        stepId: stepID,
        context: `Available steps: ${names.join(', ')}`,
        suggestion: `Change to one of: ${names.join(', ')}`,
      });
    }

    if (Array.isArray(n.conditions)) {
      n.conditions.forEach((cond: unknown, i: number) => {
        if (!isRecord(cond)) return;

        // `goto_step` is the spelling used by error_strategy and quality_gate,
        // and it is WRONG here — a condition's target key is `goto`. AIgentFlow's
        // create/update/validate path parses with KnownFields(true) and refuses
        // the flow outright ("contains unknown keys that would be silently
        // dropped"), verified against the Go parser, so this is an error and not
        // a warning. Reported explicitly because the failure is otherwise silent:
        // the branch target simply vanishes.
        // Any value: the key itself is what the reference refuses.
        if ((cond as NextCondition).goto_step !== undefined) {
          issues.error({
            field: `steps.${stepID}.next.conditions[${i}].goto_step`,
            message: "A condition's branch target key is 'goto', not 'goto_step'",
            code: 'unknown_yaml_key',
            stepId: stepID,
            suggestion:
              "Rename 'goto_step' to 'goto' (only error_strategy and quality_gate use 'goto_step')",
          });
        }

        const goto = issues.stringOf(cond, 'goto', `${nextPath}.conditions[${i}]`);
        if (goto !== null && goto !== '' && !isSaveDoorMarker(goto) && !available.has(goto)) {
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

  const start = issues.stringOf(flow, 'start', '') ?? '';
  if (start === '' || !available.has(start)) {
    // Without a valid start, reachability/cycle analysis is meaningless and
    // the missing-start error is already reported elsewhere.
    return;
  }

  // Reachability (BFS from start).
  const reachable = new Set<string>();
  const queue: string[] = [start];
  // The FLOW-level error strategy names a step that nothing else points at. It
  // belongs to the flow, not to a step, so no edge walk can reach it — AIgentFlow
  // seeds it into the queue, and missing it was the remainder found by a live
  // probe after the first pass of the fix.
  const flowErrorStrategy = flow.error_strategy;
  if (isRecord(flowErrorStrategy)) {
    const gotoStep = issues.stringOf(flowErrorStrategy, 'goto_step', 'error_strategy');
    if (gotoStep !== null && gotoStep !== '' && !isMarker(gotoStep)) queue.push(gotoStep);
  }
  while (queue.length > 0) {
    const current = queue.shift() as string;
    if (reachable.has(current)) continue;
    reachable.add(current);
    const step = steps[current];
    if (isRecord(step)) {
      for (const target of reachTargets(step, current, issues)) {
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
      const next = step.next as NextLogicDefinition;
      for (const target of cycleTargets(next, `steps.${stepID}.next`, issues)) {
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
