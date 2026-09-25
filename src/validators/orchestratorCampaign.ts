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
import {
  Issues,
  isInteger,
  isRecord,
  isString,
  isValidGoDuration,
  parseGoDuration,
} from './util.js';

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
        if (isRecord(cond) && (cond as { goto?: unknown }).goto === NEXT_MARKER_ORCHESTRATOR) {
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

    // AIF v2.695.0 (DC-FORGE-125, aigentflow#124): the per-question HITL
    // deadline. The reference REFUSES an unparseable or non-positive duration
    // (parser.go, beside the timer trigger's interval), so this oracle refuses
    // it too.
    //
    // NOTE the positivity check. `isValidGoDuration('-5m')` is true — it is a
    // well-formed Go duration — and the reference still refuses it, because a
    // deadline in the past is not a deadline. An oracle that accepted it would
    // be LOOSER than the door it predicts, which is the more damaging direction
    // for a "would this save?" answer.
    //
    // NOT ported, deliberately: the reference also LOGS a warning when the declared
    // timeout exceeds ORCH_MAX_MISSION_DURATION. That threshold is a server
    // constant this package cannot observe, and hard-coding 60m here would put
    // a second copy of a deployment-side number in another repository. See
    // PARITY.md divergence #12.
    //
    // Empty and null mean ABSENT, as they do in the reference: its field is a Go
    // string, a YAML null decodes to "", and the check runs only when the value
    // is non-empty. Refusing either would make this oracle stricter than the door.
    const declared: unknown = orch.human_question_timeout;
    if (declared !== undefined && declared !== null && declared !== '') {
      const parsed = isString(declared) ? parseGoDuration(declared) : null;
      if (parsed === null || parsed <= 0) {
        issues.error({
          field: 'orchestrator.human_question_timeout',
          message: `human_question_timeout '${String(declared)}' is not a valid positive duration`,
          code: 'orchestrator_human_question_timeout_invalid',
        });
      }
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
    const campaign = flow.campaign;

    // AIF v2.728.0 (DC-FORGE-155): `max_credits_per_child` is a Go int64, so a
    // non-integer fails to decode, and `CampaignConfig.Validate` refuses a
    // negative value. 0 (and absent, and null) means "no per-child cap".
    if (isRecord(campaign)) {
      const cap: unknown = campaign.max_credits_per_child;
      if (cap !== undefined && cap !== null) {
        if (!isInteger(cap)) {
          issues.error({
            field: 'campaign.max_credits_per_child',
            message: `campaign.max_credits_per_child must be a whole number of credits, got '${String(cap)}'`,
            code: 'invalid_type',
          });
        } else if (cap < 0) {
          issues.error({
            field: 'campaign.max_credits_per_child',
            message: 'campaign: max_credits_per_child must be >= 0',
            code: 'campaign_invalid_max_credits_per_child',
          });
        }
      }
    }

    // DC-COND-2: on_children_complete (if set) must reference a real step — the
    // engine routes into it deterministically once every child is terminal.
    if (
      isRecord(campaign) &&
      isString(campaign.on_children_complete) &&
      campaign.on_children_complete !== ''
    ) {
      const target = campaign.on_children_complete;
      const steps = isRecord(flow.steps) ? flow.steps : {};
      if (!(target in steps)) {
        issues.error({
          field: 'campaign.on_children_complete',
          message: `campaign.on_children_complete references unknown step '${target}'`,
          code: 'campaign_handoff_step_unknown',
        });
      }
    }
  }
}
