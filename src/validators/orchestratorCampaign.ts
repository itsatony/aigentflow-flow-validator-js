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
import { ORCHESTRATOR_MODES, ORCHESTRATOR_TOOLS, ORCHESTRATOR_TRIGGERS } from '../spec/index.js';
import { Issues, isRecord, isString, isValidGoDuration } from './util.js';

const TRIGGER_TIMER = 'timer';
const MODE_OWNER = 'owner';
const NEXT_MARKER_ORCHESTRATOR = 'orchestrator';

// flowHasOrchestratorYieldEdge mirrors the Go helper: does any step route to the
// orchestrator via next.default or a conditional goto? (DC-COND-1)
function flowHasOrchestratorYieldEdge(flow: Flow): boolean {
  const steps = flow.steps;
  if (!isRecord(steps)) return false;
  for (const step of Object.values(steps)) {
    if (!isRecord(step) || !isRecord(step.next)) continue;
    const next = step.next as { default?: unknown; conditions?: unknown };
    if (next.default === NEXT_MARKER_ORCHESTRATOR) return true;
    if (Array.isArray(next.conditions)) {
      for (const cond of next.conditions) {
        if (isRecord(cond) && (cond as { goto_step?: unknown }).goto_step === NEXT_MARKER_ORCHESTRATOR) {
          return true;
        }
      }
    }
  }
  return false;
}

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

    // DC-COND-1: termination-authority mode. Empty defaults to monitor (valid).
    if (isString(orch.mode) && orch.mode !== '' && !ORCHESTRATOR_MODES.has(orch.mode)) {
      issues.error({
        field: 'orchestrator.mode',
        message: `Invalid orchestrator mode '${orch.mode}'`,
        code: 'orchestrator_mode_invalid',
        suggestion: `Use one of: ${[...ORCHESTRATOR_MODES].join(', ')}`,
      });
    } else if (orch.mode === MODE_OWNER && !flowHasOrchestratorYieldEdge(flow)) {
      // owner mode cedes lifecycle to the LLM, reachable only via an explicit
      // next: orchestrator yield edge. A self-terminating DAG under owner is refused.
      issues.error({
        field: 'orchestrator.mode',
        message:
          "orchestrator mode 'owner' requires at least one step with next: 'orchestrator' (an explicit yield edge); a self-terminating DAG must use mode 'monitor'",
        code: 'orchestrator_owner_needs_yield',
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
