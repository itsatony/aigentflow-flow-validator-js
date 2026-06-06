// Orchestrator + campaign structural validation.
//
// Mirrors the portable parts of `validateOrchestrator` /
// `validateAndNormalizeCampaign` (parser.go). The exons-spec body is parsed by
// the go-exons engine in the reference and is NOT re-implemented here — its
// presence is required, but its contents are out of scope for the static JS
// validator. See PARITY.md.

import type {
  Flow,
  OrchestratorDefinition,
  OrchestratorTrigger,
  ValidateOptions,
} from '../types.js';
import { ORCHESTRATOR_TOOLS, ORCHESTRATOR_TRIGGERS } from '../spec/index.js';
import { Issues, isRecord, isString, isValidGoDuration } from './util.js';

const TRIGGER_TIMER = 'timer';

export function validateOrchestratorCampaign(
  flow: Flow,
  issues: Issues,
  opts: ValidateOptions,
): void {
  const hasOrchestrator = isRecord(flow.orchestrator);

  if (hasOrchestrator) {
    const orch = flow.orchestrator as OrchestratorDefinition;

    if (!isString(orch.exons) || orch.exons === '') {
      issues.error({
        field: 'orchestrator.exons',
        message: 'orchestrator requires an exons specification',
        code: 'orchestrator_exons_required',
      });
    }

    if (Array.isArray(orch.triggers)) {
      orch.triggers.forEach((rawTrigger: unknown, i: number) => {
        if (!isRecord(rawTrigger)) return;
        const trigger = rawTrigger as OrchestratorTrigger;
        const base = `orchestrator.triggers[${i}]`;
        if (!isString(trigger.type) || !ORCHESTRATOR_TRIGGERS.has(trigger.type)) {
          issues.error({
            field: `${base}.type`,
            message: `Unknown orchestrator trigger type '${String(trigger.type)}'`,
            code: 'orchestrator_trigger_unknown',
            suggestion: `Use one of: ${[...ORCHESTRATOR_TRIGGERS].join(', ')}`,
          });
          return;
        }
        if (trigger.type === TRIGGER_TIMER) {
          if (!isString(trigger.interval) || trigger.interval === '') {
            issues.error({
              field: `${base}.interval`,
              message: 'timer trigger requires an interval',
              code: 'orchestrator_timer_no_interval',
            });
          } else if (!isValidGoDuration(trigger.interval)) {
            issues.error({
              field: `${base}.interval`,
              message: `timer trigger interval '${trigger.interval}' is not a valid duration`,
              code: 'orchestrator_timer_bad_interval',
            });
          }
        }
      });
    }

    if (Array.isArray(orch.tools)) {
      orch.tools.forEach((tool: unknown, i: number) => {
        if (!isString(tool) || ORCHESTRATOR_TOOLS.has(tool)) return;
        const finding = {
          field: `orchestrator.tools[${i}]`,
          message: `Unrecognised orchestrator tool name '${String(tool)}'`,
          code: 'orchestrator_tool_unknown',
        };
        if (opts.strictRegistries) {
          issues.error(finding);
        } else {
          issues.warn(finding);
        }
      });
    }

    if (orch.agentic === false) {
      issues.warn({
        field: 'orchestrator.agentic',
        message: 'orchestrator is most useful with agentic: true',
        code: 'orchestrator_not_agentic',
      });
    }
  }

  // Campaign requires an orchestrator.
  if (flow.campaign !== undefined && flow.campaign !== null) {
    if (!hasOrchestrator) {
      issues.error({
        field: 'campaign',
        message: 'campaign requires an orchestrator block',
        code: 'campaign_requires_orchestrator',
      });
    }
  }
}
