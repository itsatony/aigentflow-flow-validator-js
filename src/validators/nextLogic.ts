// `next.parallel` structure.
//
// Default/condition reference checks live in connectivity.ts (they pair with
// reachability). This module covers the parser-only addition: the
// `validateNextLogic` parallel block. (`next: orchestrator` names the hand-over
// AIgentFlow removed in v2.838.0 and is `orchestrator_removed`; see
// removedSignalCampaign.ts.)

import type { Flow, NextLogicDefinition, ParallelDefinition } from '../types.js';
import { Issues, isRecord } from './util.js';

const NEXT_NULL = 'null';

export function validateNextLogic(flow: Flow, issues: Issues): void {
  const steps = flow.steps;
  if (!isRecord(steps)) return;
  const available = new Set(Object.keys(steps));

  for (const [stepID, step] of Object.entries(steps)) {
    if (!isRecord(step)) continue;
    const next = step.next;
    if (!isRecord(next)) continue;
    const n = next as NextLogicDefinition;

    // Parallel block.
    if (isRecord(n.parallel)) {
      const par = n.parallel as ParallelDefinition;
      const base = `steps.${stepID}.next.parallel`;

      // Go `string` fields: `rendezvous: 9` names the step "9".
      const rendezvous = issues.stringOf(par, 'rendezvous', base);
      if (rendezvous === null || rendezvous === '') {
        issues.error({
          field: `${base}.rendezvous`,
          message: 'parallel block requires a rendezvous step',
          code: 'missing_required_field',
          stepId: stepID,
        });
      } else if (rendezvous !== NEXT_NULL && !available.has(rendezvous)) {
        issues.error({
          field: `${base}.rendezvous`,
          message: `Referenced rendezvous step '${rendezvous}' does not exist`,
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
          const member = issues.stringAt(ps, `${base}.steps[${i}]`);
          if (member === null || !available.has(member)) {
            issues.error({
              field: `${base}.steps[${i}]`,
              message: `Referenced parallel step '${member ?? String(ps)}' does not exist`,
              code: 'step_not_found',
              stepId: stepID,
            });
          }
        });
      }
    }
  }
}
