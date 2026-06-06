// `next.parallel` structure + the orchestrator-next rule.
//
// Default/condition reference checks live in connectivity.ts (they pair with
// reachability). This module covers the parser-only additions:
// `validateNextLogic` parallel block + `validateOrchestratorNext`.

import type { Flow, NextCondition, NextLogicDefinition, ParallelDefinition } from '../types.js';
import { Issues, isRecord, isString } from './util.js';

const NEXT_NULL = 'null';
const NEXT_ORCHESTRATOR = 'orchestrator';

export function validateNextLogic(flow: Flow, issues: Issues): void {
  const steps = flow.steps;
  if (!isRecord(steps)) return;
  const available = new Set(Object.keys(steps));
  const hasOrchestrator = isRecord(flow.orchestrator);

  for (const [stepID, step] of Object.entries(steps)) {
    if (!isRecord(step)) continue;
    const next = step.next;
    if (!isRecord(next)) continue;
    const n = next as NextLogicDefinition;

    // Parallel block.
    if (isRecord(n.parallel)) {
      const par = n.parallel as ParallelDefinition;
      const base = `steps.${stepID}.next.parallel`;

      if (!isString(par.rendezvous) || par.rendezvous === '') {
        issues.error({
          field: `${base}.rendezvous`,
          message: 'parallel block requires a rendezvous step',
          code: 'missing_required_field',
          stepId: stepID,
        });
      } else if (par.rendezvous !== NEXT_NULL && !available.has(par.rendezvous)) {
        issues.error({
          field: `${base}.rendezvous`,
          message: `Referenced rendezvous step '${par.rendezvous}' does not exist`,
          code: 'step_not_found',
          stepId: stepID,
        });
      }

      if (!Array.isArray(par.steps) || par.steps.length === 0) {
        issues.error({
          field: `${base}.steps`,
          message: 'parallel block requires at least one step',
          code: 'missing_required_field',
          stepId: stepID,
        });
      } else {
        par.steps.forEach((ps: unknown, i: number) => {
          if (!isString(ps) || !available.has(ps)) {
            issues.error({
              field: `${base}.steps[${i}]`,
              message: `Referenced parallel step '${String(ps)}' does not exist`,
              code: 'step_not_found',
              stepId: stepID,
            });
          }
        });
      }
    }

    // "orchestrator" as a next target requires an orchestrator block.
    if (!hasOrchestrator) {
      const usesOrch =
        n.default === NEXT_ORCHESTRATOR ||
        (Array.isArray(n.conditions) &&
          (n.conditions as NextCondition[]).some(
            (c) => isRecord(c) && c.goto_step === NEXT_ORCHESTRATOR,
          ));
      if (usesOrch) {
        issues.error({
          field: `steps.${stepID}.next`,
          message: `Step '${stepID}' routes to 'orchestrator' but the flow has no orchestrator block`,
          code: 'orchestrator_next_requires_orchestrator',
          stepId: stepID,
        });
      }
    }
  }
}
