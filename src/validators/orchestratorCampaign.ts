// Orchestrator structural validation. (The campaign block was removed in
// AIgentFlow 2.836.0: it is refused whole as `campaign_removed` by
// removedSignalCampaign.ts, and none of its old rules run.)
//
// Mirrors the portable parts of `validateOrchestrator` (parser.go). The exons-spec body is parsed by
// the go-exons engine in the reference and is NOT re-implemented here — its
// presence is required, but its contents are out of scope for the static JS
// validator. See PARITY.md.

import type {
  Flow,
  OrchestratorDefinition,
  OrchestratorTrigger,
  ValidateOptions,
} from '../types.js';
import {
  ORCHESTRATOR_MODES,
  ORCHESTRATOR_TOOLS,
  ORCHESTRATOR_TRIGGERS,
  REMOVED_ORCHESTRATOR_TOOLS,
  REMOVED_ORCHESTRATOR_TRIGGERS,
} from '../spec/index.js';
import { Issues, isRecord, isValidGoDuration, parseGoDuration } from './util.js';

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

    // Every field read below is a Go `string` (issues.stringOf): `mode: 1` is
    // the invalid mode "1", not an absent one.
    if (!issues.nonEmptyStringOf(orch, 'exons', 'orchestrator')) {
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
      const text = issues.stringAt(declared, 'orchestrator.human_question_timeout');
      const parsed = text !== null ? parseGoDuration(text) : null;
      if (parsed === null || parsed <= 0) {
        issues.error({
          field: 'orchestrator.human_question_timeout',
          message: `human_question_timeout '${text ?? String(declared)}' is not a valid positive duration`,
          code: 'orchestrator_human_question_timeout_invalid',
        });
      }
    }

    // DC-COND-1: termination-authority mode. Empty defaults to monitor (valid).
    const mode = issues.stringOf(orch, 'mode', 'orchestrator');
    if (mode !== null && mode !== '' && !ORCHESTRATOR_MODES.has(mode)) {
      issues.error({
        field: 'orchestrator.mode',
        message: `Invalid orchestrator mode '${mode}'`,
        code: 'orchestrator_mode_invalid',
        suggestion: `Use one of: ${[...ORCHESTRATOR_MODES].join(', ')}`,
      });
    } else if (mode === MODE_OWNER && !flowHasOrchestratorYieldEdge(flow)) {
      // owner mode cedes lifecycle to the LLM, reachable only via an explicit
      // next: orchestrator yield edge. A self-terminating DAG under owner is refused.
      issues.error({
        field: 'orchestrator.mode',
        message:
          "orchestrator mode 'owner' requires at least one step with next: 'orchestrator' (an explicit yield edge); a self-terminating DAG must use mode 'monitor'",
        code: 'orchestrator_owner_needs_yield',
      });
    }

    // enforce_region makes the provider refuse a call that carries no region, so
    // declaring it without naming one would fail every turn closed; the reference
    // refuses it at save. `region` is a Go string (any scalar, null = empty) and
    // is judged after trimming whitespace.
    if (orch.enforce_region === true) {
      const region = issues.stringOf(orch, 'region', 'orchestrator');
      if (region === null || region.trim() === '') {
        issues.error({
          field: 'orchestrator.enforce_region',
          message:
            'orchestrator: enforce_region requires region (name the region the model must run in, e.g. region: eu)',
          code: 'orchestrator_enforce_region_needs_region',
          suggestion:
            'Add `region: eu` (or the region the model must run in), or drop enforce_region',
        });
      }
    }

    if (Array.isArray(orch.triggers)) {
      orch.triggers.forEach((rawTrigger: unknown, i: number) => {
        if (!isRecord(rawTrigger)) return;
        const trigger = rawTrigger as OrchestratorTrigger;
        const base = `orchestrator.triggers[${i}]`;
        const type = issues.stringOf(trigger, 'type', base);
        // A removed trigger type (dfm_suggestion, campaign_child_*) is refused
        // by its own code (removedSignalCampaign.ts), never as unknown.
        if (type !== null && REMOVED_ORCHESTRATOR_TRIGGERS.has(type)) return;
        if (type === null || !ORCHESTRATOR_TRIGGERS.has(type)) {
          issues.error({
            field: `${base}.type`,
            message: `Unknown orchestrator trigger type '${type ?? String(trigger.type)}'`,
            code: 'orchestrator_trigger_unknown',
            suggestion: `Use one of: ${[...ORCHESTRATOR_TRIGGERS].join(', ')}`,
          });
          return;
        }
        if (type === TRIGGER_TIMER) {
          // A Go `string` field, filled from ANY scalar by its source text:
          // `interval: 0` is "0" and saves, `interval: 100` is "100" (no unit).
          // A number used to read as "no interval" here.
          const interval = issues.stringOf(trigger, 'interval', base);
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
      orch.tools.forEach((raw: unknown, i: number) => {
        const tool = issues.stringAt(raw, `orchestrator.tools[${i}]`);
        // A removed signal / campaign name is refused by its own code, never as
        // unknown.
        if (tool === null || ORCHESTRATOR_TOOLS.has(tool) || REMOVED_ORCHESTRATOR_TOOLS.has(tool)) {
          return;
        }
        const finding = {
          field: `orchestrator.tools[${i}]`,
          message: `Unrecognised orchestrator tool name '${tool}'`,
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
}
