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
  isRecord,
  isString,
  isValidGoDuration,
  parseGoDuration,
  scalarText,
  scalarTextAt,
  type ScalarSources,
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

/** 2^63: the first float yaml.v3 will not decode into an int64. */
const GO_INT64_FLOAT_LIMIT = 2 ** 63;

// decodeGoInt returns the value yaml.v3 stores when it decodes a YAML number
// into a Go int64 field, or null when the decode fails. A float is truncated
// toward zero; NaN and anything at or above 2^63 fail; -Inf and very large
// negative floats land at the bottom of the range (their exact value is
// platform-defined in Go, but always negative, which is all a caller needs).
function decodeGoInt(v: unknown): number | null {
  if (typeof v !== 'number' || Number.isNaN(v)) return null;
  if (v >= GO_INT64_FLOAT_LIMIT) return null;
  if (v === -Infinity) return -GO_INT64_FLOAT_LIMIT;
  return Math.trunc(v);
}

// validateCampaignChildFlows ports the first two checks of
// CampaignConfig.Validate (domain.campaign.go): the campaign needs at least one
// child flow, and each entry names a `flow_id` or a `flow_name`.
//
// ⚠️ yaml.v3 DROPS a null list entry when it decodes the list, so `- ` does not
// count as an entry — a list of nothing but nulls is "no child flows", and a
// null beside a real entry is simply ignored (measured: both save/refuse as
// described). `flow_id` and `flow_name` are Go strings, so any scalar counts
// (`flow_id: 123` saves) and a YAML null is empty. The finding's index is the
// entry's position in the YAML list; the reference's message counts only the
// non-null entries.
function validateCampaignChildFlows(campaign: Record<string, unknown>, issues: Issues): void {
  const field = 'campaign.child_flows';
  const raw: unknown = campaign.child_flows;
  if (raw !== undefined && raw !== null && !Array.isArray(raw)) {
    issues.error({ field, message: 'campaign.child_flows must be a list', code: 'invalid_type' });
    return;
  }
  const entries = (Array.isArray(raw) ? raw : [])
    .map((entry: unknown, i: number) => ({ entry, i }))
    .filter(({ entry }) => entry !== null);
  if (entries.length === 0) {
    issues.error({
      field,
      message: 'campaign requires at least one entry in child_flows',
      code: 'campaign_no_child_flows',
    });
    return;
  }
  for (const { entry, i } of entries) {
    if (!isRecord(entry)) {
      issues.error({
        field: `${field}[${i}]`,
        message: 'each campaign.child_flows entry must be a mapping',
        code: 'invalid_type',
      });
      continue;
    }
    const id = scalarText(entry.flow_id);
    const name = scalarText(entry.flow_name);
    if ((id !== null && id !== '') || (name !== null && name !== '')) continue;
    issues.error({
      field: `${field}[${i}]`,
      message: `campaign.child_flows[${i}] needs a flow_id or a flow_name`,
      code: 'campaign_child_flow_no_id',
      suggestion: 'Name the child flow with flow_name, or pin it with flow_id',
    });
  }
}

export function validateOrchestratorCampaign(
  flow: Flow,
  issues: Issues,
  opts: ValidateOptions,
  sources?: ScalarSources,
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
          // A Go `string` field, filled from ANY scalar by its source text:
          // `interval: 0` is "0" and saves, `interval: 100` is "100" (no unit).
          // A number used to read as "no interval" here.
          const interval = scalarTextAt(trigger.interval, `${base}.interval`, sources);
          if (interval === null || interval === '') {
            issues.error({
              field: `${base}.interval`,
              message: 'timer trigger requires an interval',
              code: 'orchestrator_timer_no_interval',
            });
          } else if (!isValidGoDuration(interval)) {
            issues.error({
              field: `${base}.interval`,
              message: `timer trigger interval '${interval}' is not a valid duration`,
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

    // AIF v2.728.0 (DC-FORGE-155): `max_credits_per_child` is a Go int64 and
    // `CampaignConfig.Validate` refuses a negative value. 0 (and absent, and
    // null) means "no per-child cap".
    //
    // ⚠️ A FRACTION SAVES. yaml.v3 decodes a float into an int field by
    // truncating toward zero, so `1.5` is stored as 1 and `-0.5` as 0 (which
    // then passes the `>= 0` check). Measured against the reference's strict
    // save parser; this validator used to refuse every non-integer, which made
    // it stricter than the door it predicts. What still fails to decode: a
    // string, a boolean, NaN, +Inf, and a float at or above 2^63. `-.inf`
    // decodes to a negative int64 and is refused by the `>= 0` check.
    if (isRecord(campaign)) {
      const cap: unknown = campaign.max_credits_per_child;
      if (cap !== undefined && cap !== null) {
        const decoded = decodeGoInt(cap);
        if (decoded === null) {
          issues.error({
            field: 'campaign.max_credits_per_child',
            message: `campaign.max_credits_per_child must be a number of credits, got '${String(cap)}'`,
            code: 'invalid_type',
          });
        } else if (decoded < 0) {
          issues.error({
            field: 'campaign.max_credits_per_child',
            message: 'campaign: max_credits_per_child must be >= 0',
            code: 'campaign_invalid_max_credits_per_child',
          });
        }
      }
      validateCampaignChildFlows(campaign, issues);
    }

    // The rest of CampaignConfig.Validate — max_concurrent, max_depth and
    // max_total_children must each be >= 1 — is UNREACHABLE at the save door
    // and deliberately not ported: ApplyDefaults runs first and replaces every
    // value <= 0 with a positive default, so no document can reach it.

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
