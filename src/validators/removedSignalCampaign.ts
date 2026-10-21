// The flow surfaces AIgentFlow removed after its own agent chains: agent
// signals and dynamic flow modification (v2.834.0), campaigns (v2.836.0) and
// the orchestrator (v2.838.0). The vocabulary lives in the spec blocks
// `removedSignalSurfaces`, `removedCampaignSurfaces` and
// `removedOrchestratorSurfaces`; the reference is aigentflow.removed.*surfaces.go.
//
// Four ERROR codes (`signal_removed`, `flow_modification_removed`,
// `campaign_removed`, `orchestrator_removed`) and one WARNING
// (`removed_key_ignored`, for `checkpoint.pre_dfm`, which AIgentFlow may have
// written into a stored flow itself). The removed blocks are judged on presence
// and refused WHOLE: nothing inside the `orchestrator:` or `campaign:` block is
// judged, and both stay in knownKeys typed `any`, so each surface is reported
// once, by its own code, with its advice.
//
// Order, as in the reference: the signal / DFM step findings, the campaign
// block, the orchestrator block, the flow-level discovery keys, then the steps
// that route next to the orchestrator (by id).

import type { Flow } from '../types.js';
import {
  REMOVED_AGENT_SURFACES,
  REMOVED_CAMPAIGN_SURFACES,
  REMOVED_ORCHESTRATOR_SURFACES,
  REMOVED_SIGNAL_SURFACES,
} from '../spec/index.js';
import { removedExecutorScheme } from './executors.js';
import { Issues, isRecord } from './util.js';

const TEMPLATE_ACTION_OPEN = '{{';

/** Fills the spec's `%q` / `%s` placeholders in order. */
function fill(format: string, ...args: string[]): string {
  let i = 0;
  return format.replace(/%[qs]/g, () => args[i++] ?? '');
}

/** An own property holding a non-null value (a YAML null is absent). */
function present(m: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(m, key) && m[key] !== undefined && m[key] !== null;
}

/** Whether a next block names `target` exactly, as its default or any condition's goto. */
function routesTo(next: unknown, target: string): boolean {
  if (!isRecord(next)) return false;
  if (next.default === target) return true;
  const conditions = next.conditions;
  return Array.isArray(conditions) && conditions.some((c) => isRecord(c) && c.goto === target);
}

export function validateRemovedOrchestratorSurfaces(flow: Flow, issues: Issues): void {
  validateRemovedSignalStepKeys(flow, issues);

  // Campaigns: the block, judged on presence (any non-null value), refused whole.
  const camp = REMOVED_CAMPAIGN_SURFACES;
  if (present(flow, camp.flowKey)) {
    issues.error({
      field: camp.flowKey,
      code: camp.code,
      message: camp.blockMessage,
      suggestion: camp.suggestion,
    });
  }

  validateRemovedOrchestrator(flow, issues);

  // The inert key: a WARNING, never an error. A YAML null is absent.
  const sig = REMOVED_SIGNAL_SURFACES;
  const checkpoint = flow.checkpoint;
  if (isRecord(checkpoint) && checkpoint.pre_dfm !== undefined && checkpoint.pre_dfm !== null) {
    const field = 'checkpoint.pre_dfm';
    issues.warn({
      field,
      code: sig.removedKeyIgnoredCode,
      message: fill(sig.ignoredKeyMessageFormat, field),
      suggestion: sig.ignoredKeySuggestion,
    });
  }
}

// The two removed step keys, on map presence (null and false included):
// `flow_modification_allowed` on any step, `enable_signals` on an aiv:// step
// (ai:// reports it as agentic_param_removed). Skipped: templated executors,
// removed schemes (the step is executor_removed already) and flow:// (its query
// is the child's inputs).
function validateRemovedSignalStepKeys(flow: Flow, issues: Issues): void {
  const sig = REMOVED_SIGNAL_SURFACES;
  const judgeStep = (executor: unknown, query: unknown, field: string, stepID: string): void => {
    if (typeof executor !== 'string' || executor === '') return;
    if (executor.includes(TEMPLATE_ACTION_OPEN)) return;
    const scheme = removedExecutorScheme(executor);
    if (REMOVED_AGENT_SURFACES.schemes.has(scheme) || sig.stepSkipSchemes.has(scheme)) return;
    if (!isRecord(query)) return;
    const quoted = JSON.stringify(stepID);
    if (Object.prototype.hasOwnProperty.call(query, sig.flowModificationStepKey)) {
      issues.error({
        field,
        code: sig.flowModificationRemovedCode,
        stepId: stepID,
        message: fill(sig.flowModificationStepMessageFormat, quoted),
        suggestion: sig.suggestion,
      });
    }
    if (scheme === sig.stepKeyScheme && Object.prototype.hasOwnProperty.call(query, sig.stepKey)) {
      issues.error({
        field,
        code: sig.signalRemovedCode,
        stepId: stepID,
        message: fill(sig.stepKeyMessageFormat, quoted),
        suggestion: sig.suggestion,
      });
    }
  };
  const steps = flow.steps;
  if (!isRecord(steps)) return;
  for (const stepID of Object.keys(steps).sort()) {
    const step = steps[stepID];
    if (!isRecord(step)) continue;
    judgeStep(step.executor, step.query, `steps.${stepID}`, stepID);
    const loop = step.loop;
    if (!isRecord(loop) || !Array.isArray(loop.steps)) continue;
    loop.steps.forEach((sub: unknown, i: number) => {
      if (!isRecord(sub)) return;
      // The composite id executors.ts gives the same sub-step.
      const subID = issues.stringOf(sub, 'id', `steps.${stepID}.loop.steps[${i}]`) ?? String(i);
      judgeStep(sub.executor, sub.query, `steps.${stepID}.loop.steps[${i}]`, `${stepID}.${subID}`);
    });
  }
}

// orchestrator_removed: the block (any non-null value, a scalar or list
// included), each flow-level discovery key (any non-null value, '' and []
// included), and every top-level step whose next.default or a condition's goto
// is exactly `orchestrator` (one finding per step). Loop sub-steps are not
// judged here: their next refuses the marker already (loop_substep_next_sentinel).
function validateRemovedOrchestrator(flow: Flow, issues: Issues): void {
  const cfg = REMOVED_ORCHESTRATOR_SURFACES;
  if (present(flow, cfg.blockKey)) {
    issues.error({
      field: cfg.blockKey,
      code: cfg.code,
      message: cfg.blockMessage,
      suggestion: cfg.suggestion,
    });
  }
  for (const key of cfg.discoveryKeys) {
    if (!present(flow, key)) continue;
    issues.error({
      field: key,
      code: cfg.code,
      message: fill(cfg.flowKeyMessageFormat, JSON.stringify(key)),
      suggestion: cfg.suggestion,
    });
  }
  const steps = flow.steps;
  if (!isRecord(steps)) return;
  for (const stepID of Object.keys(steps).sort()) {
    const step = steps[stepID];
    if (!isRecord(step) || !routesTo(step.next, cfg.nextMarker)) continue;
    issues.error({
      field: `steps.${stepID}`,
      code: cfg.code,
      stepId: stepID,
      message: fill(cfg.nextMessageFormat, JSON.stringify(stepID)),
      suggestion: cfg.suggestion,
    });
  }
}
