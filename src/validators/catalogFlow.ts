// Catalogue sub-flows and partials (AIgentFlow 2.912.0, validation.catalogflow.go).
//
// `flow://aiv/<org>/<name>` runs a published aigentverse flow as a sub-flow;
// `include://aiv/<org>/<name>` is replaced by a published flow's steps before the
// flow runs. Both take exactly one org and one name segment. `flow_version` pins
// the published version (strict semver) and belongs only on such a step. A
// templated URL is judged when it is rendered, so it is skipped here. Every
// finding is an ERROR, in a loop body too.

import { CATALOG_FLOW, TEMPLATE_ACTION_OPEN } from '../spec/index.js';
import type { Flow, LoopSubStep, StepDefinition } from '../types.js';
import { Issues, isRecord } from './util.js';

const SCHEME_SEPARATOR = '://';

function catalogPrefix(executor: string): string | null {
  for (const prefix of CATALOG_FLOW.refPrefixes) {
    if (executor.startsWith(prefix)) return prefix;
  }
  return null;
}

function validRef(resource: string): boolean {
  const parts = resource.split('/');
  return parts.length === 2 && parts.every((p) => CATALOG_FLOW.segmentPattern.test(p));
}

function format(messageFormat: string, ...args: string[]): string {
  let message = messageFormat;
  for (const a of args) message = message.replace(/%[sq]/, () => a);
  return message;
}

function checkSite(
  executor: unknown,
  flowVersion: unknown,
  path: string,
  stepID: string,
  issues: Issues,
): void {
  const url = typeof executor === 'string' ? executor : '';
  const prefix = catalogPrefix(url);
  if (prefix !== null && !url.includes(TEMPLATE_ACTION_OPEN)) {
    if (!validRef(url.slice(prefix.length))) {
      const scheme = url.slice(0, url.indexOf(SCHEME_SEPARATOR));
      const rule = CATALOG_FLOW.refInvalid;
      issues.error({
        field: `${path}.executor`,
        message: format(rule.messageFormat, stepID, url, scheme),
        code: rule.code,
        stepId: stepID,
        suggestion: rule.suggestion,
      });
    }
  }
  if (flowVersion === undefined || flowVersion === null || flowVersion === '') return;
  const version = String(flowVersion);
  if (prefix === null) {
    const rule = CATALOG_FLOW.versionPlacement;
    issues.error({
      field: `${path}.flow_version`,
      message: format(rule.messageFormat, stepID, url),
      code: rule.code,
      stepId: stepID,
      suggestion: rule.suggestion,
    });
    return;
  }
  if (!CATALOG_FLOW.versionPattern.test(version)) {
    const rule = CATALOG_FLOW.versionInvalid;
    issues.error({
      field: `${path}.flow_version`,
      message: format(rule.messageFormat, stepID, JSON.stringify(version)),
      code: rule.code,
      stepId: stepID,
      suggestion: rule.suggestion,
    });
  }
}

export function validateCatalogFlowSteps(f: Flow, issues: Issues): void {
  const steps = f.steps;
  if (!isRecord(steps)) return;
  for (const [stepID, rawStep] of Object.entries(steps)) {
    if (!isRecord(rawStep)) continue;
    const step = rawStep as StepDefinition & { flow_version?: unknown };
    checkSite(step.executor, step.flow_version, `steps.${stepID}`, stepID, issues);
    const loop = step.loop;
    if (isRecord(loop) && Array.isArray(loop.steps)) {
      loop.steps.forEach((sub: unknown, i: number) => {
        if (!isRecord(sub)) return;
        const subStep = sub as LoopSubStep & { flow_version?: unknown };
        const subID = typeof subStep.id === 'string' && subStep.id !== '' ? subStep.id : String(i);
        checkSite(
          subStep.executor,
          subStep.flow_version,
          `steps.${stepID}.loop.steps[${i}]`,
          `${stepID}.${subID}`,
          issues,
        );
      });
    }
  }
}
