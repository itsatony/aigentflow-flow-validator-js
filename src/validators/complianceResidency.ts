// `compliance_residency_unenforced` (WARNING): an EU-only `compliance.residency`
// beside a literal model call that nothing pins to the EU.
//
// Port of the reference's `validateResidencyEnforcement` (AIgentFlow v2.821.0),
// together with the Go port. `compliance.residency` is checked by the reference
// against its model CATALOGUE (declared deployments, not the host a call
// dials); that check needs the catalogue and is not ported (PARITY.md). This
// rule needs none, so it is: it says which calls leave the flow's residency
// declaration without any evidence behind it.
//
// A warning, never an error: the call may be correct (the key is EU-confined, a
// run input supplies the region) and a static check cannot see that.
//
// The rule is in the spec (`complianceResidency`): the EU-only code set, the
// region-lane providers (those whose adapter routes on `region`), the formats.
// A provider with no region lane (scaleway, vaiembed, anthropic native, ...)
// cannot be pinned by these keys and is never warned.

import type { Flow } from '../types.js';
import { COMPLIANCE_RESIDENCY as CFG, TEMPLATE_ACTION_OPEN } from '../spec/index.js';
import { goTrimSpace, inspectExonsFrontmatter } from './exons.js';
import { loopSubStepsOfStep } from './processingOperations.js';
import { Issues, isArray, isRecord } from './util.js';

/** An own property of a plain object (never one of Object.prototype's). */
function own(m: unknown, key: string): unknown {
  if (!isRecord(m) || !Object.prototype.hasOwnProperty.call(m, key)) return undefined;
  return m[key];
}

/** Go's `fmt.Sprintf` for a format of `%s` / `%q` verbs; `%q` quotes, `%v` takes the text as given. */
function sprintf(format: string, ...args: string[]): string {
  let i = 0;
  return format.replace(/%[sqv]/g, (verb) => {
    const arg = args[i++] ?? '';
    return verb === '%q' ? JSON.stringify(arg) : arg;
  });
}

/** The trimmed value, or '' when it is a template. */
function literalOrEmpty(s: string): string {
  const t = goTrimSpace(s);
  return t.includes(TEMPLATE_ACTION_OPEN) ? '' : t;
}

/**
 * The declared residency codes when the declaration is EU-only (non-empty, every
 * code, trimmed and upper-cased, in the EU set), else null. `["EU","US"]` is not
 * EU-only: residency means "at least one of these".
 */
function euOnlyResidency(flow: Flow, issues: Issues): string[] | null {
  const raw = own(own(flow, 'compliance'), 'residency');
  if (!isArray(raw)) return null;
  const codes: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === null) continue; // yaml.v3 drops a null list element
    const code = issues.stringAt(raw[i], `compliance.residency[${i}]`);
    if (code === null) return null;
    codes.push(code);
  }
  if (codes.length === 0) return null;
  const eu = new Set(CFG.euResidencyCodes);
  return codes.every((c) => eu.has(goTrimSpace(c).toUpperCase())) ? codes : null;
}

/** The provider segment of `ai://<provider>/<operation>`: present only when a slash follows it. */
function aiProvider(executor: string): string {
  const prefix = CFG.aiProtocol + CFG.protocolSeparator;
  if (!executor.startsWith(prefix)) return '';
  const rest = executor.slice(prefix.length);
  const slash = rest.indexOf('/');
  const provider = slash > 0 ? rest.slice(0, slash) : '';
  return provider.includes(TEMPLATE_ACTION_OPEN) ? '' : provider;
}

function isRegionLane(provider: string): boolean {
  const literal = literalOrEmpty(provider);
  return literal !== '' && CFG.regionLaneProviders.includes(literal.toLowerCase());
}

/** The reference's `query[key].(string)`, non-empty after trimming. */
function nonBlankString(m: unknown, key: string): boolean {
  const v = own(m, key);
  return typeof v === 'string' && goTrimSpace(v) !== '';
}

/** The reference's `getBoolParam`: a bool, or one of the strings true / 1 / yes. */
function queryEnforcesRegion(query: unknown): boolean {
  const v = own(query, CFG.enforceRegionParam);
  if (typeof v === 'boolean') return v;
  return typeof v === 'string' && CFG.enforceRegionTrueStrings.includes(v);
}

/** executor_config.<provider>.base_url names the host (the author chose it). */
function flowDirectsEndpoint(flow: Flow, provider: string, issues: Issues): boolean {
  const key = provider.toLowerCase();
  const inst = own(own(flow, 'executor_config'), key);
  if (!isRecord(inst)) return false;
  const baseUrl = issues.stringOf(inst, 'base_url', `executor_config.${key}`);
  return baseUrl !== null && goTrimSpace(baseUrl) !== '';
}

function callPinsEndpoint(flow: Flow, provider: string, query: unknown, issues: Issues): boolean {
  if (nonBlankString(query, CFG.regionParam)) return true;
  if (queryEnforcesRegion(query)) return true;
  if (nonBlankString(query, provider.toLowerCase() + CFG.baseUrlParamSuffix)) return true;
  return flowDirectsEndpoint(flow, provider, issues);
}

export function validateResidencyEnforcement(flow: Flow, issues: Issues): void {
  const residency = euOnlyResidency(flow, issues);
  if (residency === null) return;
  const warn = (
    site: string,
    field: string,
    stepId: string | undefined,
    provider: string,
  ): void => {
    issues.warn({
      field,
      ...(stepId === undefined ? {} : { stepId }),
      code: CFG.code,
      message: sprintf(CFG.messageFormat, site, provider, `[${residency.join(' ')}]`),
      suggestion: CFG.suggestion,
    });
  };

  const steps = flow.steps;
  if (isRecord(steps)) {
    for (const stepId of Object.keys(steps).sort()) {
      const step = steps[stepId];
      if (!isRecord(step)) continue;
      const calls: { executor: string; query: unknown; subId: string | null }[] = [
        {
          executor: issues.stringOf(step, 'executor', `steps.${stepId}`) ?? '',
          query: own(step, 'query'),
          subId: null,
        },
      ];
      for (const sub of loopSubStepsOfStep(stepId, step)) {
        calls.push({
          executor: issues.stringOf(sub.raw, 'executor', sub.basePath) ?? '',
          query: own(sub.raw, 'query'),
          subId: issues.stringOf(sub.raw, 'id', sub.basePath) ?? '',
        });
      }
      for (const call of calls) {
        const provider = aiProvider(call.executor);
        if (!isRegionLane(provider)) continue;
        if (callPinsEndpoint(flow, provider, call.query, issues)) continue;
        if (call.subId === null) {
          warn(
            sprintf(CFG.siteStepFormat, stepId),
            sprintf(CFG.stepFieldFormat, stepId),
            stepId,
            provider,
          );
        } else {
          warn(
            sprintf(CFG.siteLoopStepFormat, call.subId, stepId),
            sprintf(CFG.loopStepFieldFormat, stepId, call.subId),
            stepId,
            provider,
          );
        }
      }
    }
  }

  warnOrchestrator(flow, issues, warn);
}

/**
 * The orchestrator's provider is `execution.provider` of its exons frontmatter.
 * A document this validator cannot read the way the engine would (a tag in the
 * frontmatter, undecodable YAML) is skipped: no provider is known.
 */
function warnOrchestrator(
  flow: Flow,
  issues: Issues,
  warn: (site: string, field: string, stepId: string | undefined, provider: string) => void,
): void {
  const orch: unknown = flow.orchestrator;
  if (!isRecord(orch)) return;
  const source = issues.stringOf(orch, 'exons', 'orchestrator');
  if (source === null || source === '') return;
  const report = inspectExonsFrontmatter(source);
  if (report.parseError !== null || !report.specRead || !report.hasSpec) return;
  const provider = literalOrEmpty(report.provider);
  if (!isRegionLane(provider)) return;
  const region = issues.stringOf(orch, 'region', 'orchestrator');
  if (region !== null && goTrimSpace(region) !== '') return;
  if (orch.enforce_region === true) return;
  if (flowDirectsEndpoint(flow, provider, issues)) return;
  warn(CFG.siteOrchestrator, CFG.orchestratorField, undefined, provider);
}
