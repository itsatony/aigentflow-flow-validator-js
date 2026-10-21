// The orchestrator surfaces AIgentFlow removed after its own agent chains:
// agent signals and dynamic flow modification (v2.834.0, AGENTCUT B1) and
// campaigns (v2.836.0, AGENTCUT B2). The vocabulary lives in the spec blocks
// `removedSignalSurfaces` and `removedCampaignSurfaces`; the reference is
// aigentflow.removed.signalsurfaces.go / .campaignsurfaces.go.
//
// Three ERROR codes (`signal_removed`, `flow_modification_removed`,
// `campaign_removed`) and one WARNING (`removed_key_ignored`, for the two inert
// keys AIgentFlow may have written into a stored flow itself). The removed tool
// and trigger names left the registries but are tolerated by the unknown-name
// checks, and the removed block keys stay in knownKeys, so each surface is
// reported once, by its own code, with its advice.
//
// Order, as in the reference: the signal findings on the orchestrator block,
// the campaign findings (block, lists, triggers), then the step findings, a
// step's loop sub-steps after it.

import type { Flow } from '../types.js';
import {
  REMOVED_AGENT_SURFACES,
  REMOVED_CAMPAIGN_SURFACES,
  REMOVED_SIGNAL_SURFACES,
} from '../spec/index.js';
import { removedExecutorScheme } from './executors.js';
import { inspectExonsFrontmatter } from './exons.js';
import { Issues, isRecord } from './util.js';

const TEMPLATE_ACTION_OPEN = '{{';

/** Fills the spec's `%q` / `%s` placeholders in order. */
function fill(format: string, ...args: string[]): string {
  let i = 0;
  return format.replace(/%[qs]/g, () => args[i++] ?? '');
}

/** The string entries of a list-valued key, in order. */
function stringEntries(m: Record<string, unknown>, key: string): string[] {
  const raw = m[key];
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [];
}

/** The string `type` of each orchestrator trigger, in order. */
function triggerTypes(orch: Record<string, unknown>): string[] {
  const raw = orch.triggers;
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const t of raw) {
    if (isRecord(t) && typeof t.type === 'string') out.push(t.type);
  }
  return out;
}

/** The entries of `names` that are in `removed`, in list order, each once. */
function namesIn(names: readonly string[], removed: readonly string[]): string[] {
  const found: string[] = [];
  for (const name of names) {
    if (removed.includes(name) && !found.includes(name)) found.push(name);
  }
  return found;
}

/** The orchestrator definition's `tools.allow`, or [] when it cannot be read. */
function orchestratorToolsAllow(orch: Record<string, unknown>): string[] {
  const source = orch.exons;
  if (typeof source !== 'string' || source === '') return [];
  const report = inspectExonsFrontmatter(source);
  if (report.parseError !== null || !report.specRead || !report.toolsAllowDeclared) return [];
  return [...report.toolsAllow];
}

export function validateRemovedOrchestratorSurfaces(flow: Flow, issues: Issues): void {
  const sig = REMOVED_SIGNAL_SURFACES;
  const camp = REMOVED_CAMPAIGN_SURFACES;
  const orch = isRecord(flow.orchestrator) ? flow.orchestrator : null;

  // The four tool lists, in the reference's order. tools.allow is reported at
  // the orchestrator's exons document, as orchestrator_tool_withheld is.
  const lists: { field: string; names: string[] }[] =
    orch === null
      ? []
      : [
          ...['tools', 'deny_tools', 'require_approval_for'].map((key) => ({
            field: `orchestrator.${key}`,
            names: stringEntries(orch, key),
          })),
          { field: 'orchestrator.exons', names: orchestratorToolsAllow(orch) },
        ];

  // B1: signals and DFM on the orchestrator block.
  if (orch !== null) {
    if (orch.enable_signals === true) {
      issues.error({
        field: 'orchestrator.enable_signals',
        code: sig.signalRemovedCode,
        message: sig.enableSignalsMessage,
        suggestion: sig.suggestion,
      });
    }
    for (const list of lists) {
      const named = namesIn(list.names, sig.tools);
      if (named.length === 0) continue;
      issues.error({
        field: list.field,
        code: sig.signalRemovedCode,
        message: fill(sig.toolNamesMessageFormat, list.field, named.join(', ')),
        suggestion: sig.suggestion,
      });
    }
    if (namesIn(triggerTypes(orch), sig.triggers).length > 0) {
      issues.error({
        field: 'orchestrator.triggers',
        code: sig.flowModificationRemovedCode,
        message: sig.triggersMessage,
        suggestion: sig.suggestion,
      });
    }
  }

  // B2: campaigns. The block is judged on presence (any non-null value) and
  // refused whole.
  const block: unknown = flow[camp.flowKey];
  if (block !== undefined && block !== null) {
    issues.error({
      field: camp.flowKey,
      code: camp.code,
      message: camp.blockMessage,
      suggestion: camp.suggestion,
    });
  }
  if (orch !== null) {
    for (const list of lists) {
      const named = namesIn(list.names, camp.tools);
      if (named.length === 0) continue;
      issues.error({
        field: list.field,
        code: camp.code,
        message: fill(camp.toolNamesMessageFormat, list.field, named.join(', ')),
        suggestion: camp.suggestion,
      });
    }
    const triggers = namesIn(triggerTypes(orch), camp.triggers);
    if (triggers.length > 0) {
      issues.error({
        field: 'orchestrator.triggers',
        code: camp.code,
        message: fill(camp.triggersMessageFormat, triggers.join(', ')),
        suggestion: camp.suggestion,
      });
    }
  }

  // B1: the step keys, on map presence (null and false included).
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
  if (isRecord(steps)) {
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
        judgeStep(
          sub.executor,
          sub.query,
          `steps.${stepID}.loop.steps[${i}]`,
          `${stepID}.${subID}`,
        );
      });
    }
  }

  // The inert keys: a WARNING, never an error. A YAML null is absent.
  const ignored = (field: string): void =>
    issues.warn({
      field,
      code: sig.removedKeyIgnoredCode,
      message: fill(sig.ignoredKeyMessageFormat, field),
      suggestion: sig.ignoredKeySuggestion,
    });
  if (orch !== null && orch.enable_signals === false) ignored('orchestrator.enable_signals');
  const checkpoint = flow.checkpoint;
  if (isRecord(checkpoint) && checkpoint.pre_dfm !== undefined && checkpoint.pre_dfm !== null) {
    ignored('checkpoint.pre_dfm');
  }
}
