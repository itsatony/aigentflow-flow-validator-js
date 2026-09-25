// Grammar keys AIgentFlow deleted because nothing read them (AIF DC-FORGE-150,
// v2.721.0): the top-level `budget:`, the top-level `max_retries:`, and a
// `max_retries:` directly on a step.
//
// The reference's save door (create / update / `POST /flows/validate`) parses
// with yaml `KnownFields(true)`, so a flow declaring any of them is REFUSED, and
// its `retiredGrammarKeys` table (parser.go) attaches migration advice to the
// refusal. Stored flows still load leniently and run. This validator answers
// "would this save", so each is an ERROR here — reported with the same code as
// the other key the reference refuses specifically, `unknown_yaml_key`
// (connectivity.ts, `next.conditions[].goto_step`).
//
// The working keys one level DOWN must never be reported: `error_strategy.
// max_retries` (flow and step level) and `quality_gate.max_retries` are live
// grammar, and `billing.max_credits` is the enforced spend ceiling.

import type { Flow } from '../types.js';
import { Issues, isRecord, isString } from './util.js';

const CODE_UNKNOWN_YAML_KEY = 'unknown_yaml_key';
const KEY_BUDGET = 'budget';
const KEY_MAX_RETRIES = 'max_retries';
const REMOVED_IN = 'v2.721.0';

const BUDGET_MESSAGE =
  `The flow-level \`budget:\` key was removed from the grammar in AIgentFlow ${REMOVED_IN} ` +
  'because nothing read it (it limited no spend), and AIgentFlow refuses to save a flow ' +
  'that declares it.';
const BUDGET_SUGGESTION =
  'Delete it. To cap spend use `billing: { max_credits: N }` — it caps the credit ' +
  'reservation and refuses further agentic turns (agentic ai://, exons://, the ' +
  'orchestrator); plain chat steps and flow:// sub-flows are not checked against it.';

function maxRetriesMessage(owner: string): string {
  return (
    `\`max_retries:\` on ${owner} was removed from the grammar in AIgentFlow ${REMOVED_IN} ` +
    'because the retry engine never read it, and AIgentFlow refuses to save a flow that ' +
    'declares it.'
  );
}
const MAX_RETRIES_SUGGESTION =
  'Delete it. To retry a step write `error_strategy: { action: "retry", max_retries: N }` ' +
  'on that step (or on the flow) — the same key one level down, which is the one that ' +
  'works (N counts attempts, including the first).';

/** Key PRESENCE, not value: the strict decoder refuses the key whatever it holds, `0` and `null` included. */
function declares(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

export function validateRetiredKeys(flow: Flow, issues: Issues): void {
  const root = flow as Record<string, unknown>;

  if (declares(root, KEY_BUDGET)) {
    issues.error({
      field: KEY_BUDGET,
      message: BUDGET_MESSAGE,
      code: CODE_UNKNOWN_YAML_KEY,
      suggestion: BUDGET_SUGGESTION,
    });
  }

  if (declares(root, KEY_MAX_RETRIES)) {
    issues.error({
      field: KEY_MAX_RETRIES,
      message: maxRetriesMessage('the flow'),
      code: CODE_UNKNOWN_YAML_KEY,
      suggestion: MAX_RETRIES_SUGGESTION,
    });
  }

  const steps = flow.steps;
  if (!isRecord(steps)) return;
  for (const [stepID, rawStep] of Object.entries(steps)) {
    if (!isRecord(rawStep)) continue;
    if (declares(rawStep, KEY_MAX_RETRIES)) {
      issues.error({
        field: `steps.${stepID}.${KEY_MAX_RETRIES}`,
        message: maxRetriesMessage(`step '${stepID}'`),
        code: CODE_UNKNOWN_YAML_KEY,
        stepId: stepID,
        suggestion: MAX_RETRIES_SUGGESTION,
      });
    }

    // A loop sub-step's type in the reference never had a `max_retries` field,
    // so the strict decoder refuses it there too — and the reference's advice
    // table matches the key name, not the type, so it attaches this same
    // advice. Reported for "would this save" parity (see PARITY.md).
    const loop = rawStep.loop;
    if (!isRecord(loop) || !Array.isArray(loop.steps)) continue;
    loop.steps.forEach((sub: unknown, i: number) => {
      if (!isRecord(sub) || !declares(sub, KEY_MAX_RETRIES)) return;
      const subID = isString(sub.id) ? sub.id : String(i);
      issues.error({
        field: `steps.${stepID}.loop.steps[${i}].${KEY_MAX_RETRIES}`,
        message: maxRetriesMessage(`loop sub-step '${stepID}.${subID}'`),
        code: CODE_UNKNOWN_YAML_KEY,
        stepId: `${stepID}.${subID}`,
        suggestion: MAX_RETRIES_SUGGESTION,
      });
    });
  }
}
