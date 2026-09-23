// Two limits a flow can declare that nothing in the reference's engine reads.
//
// Mirrors `validateFlowBudgetIsEnforced` and `validateMaxRetriesIsRead`
// (validation.go, AIF DC-FORGE-146). Both are WARNINGS on both sides: the
// reference consults them at its RUN door over flows that are already stored,
// and each declaration is INERT rather than fatal — the run does not die, it
// simply is not limited by the number the author wrote.

import type { Flow } from '../types.js';
import { Issues, isRecord, isString } from './util.js';

const CODE_FLOW_BUDGET_UNENFORCED = 'flow_budget_unenforced';
const CODE_MAX_RETRIES_UNREAD = 'max_retries_unread';
const FIELD_BUDGET = 'budget';
const FIELD_MAX_RETRIES = 'max_retries';
const DEFAULT_CURRENCY = 'USD';
const OWNER_FLOW = 'the flow';

/** Go's `%g` switches to exponent form below this decimal exponent... */
const GO_G_MIN_DECIMAL_EXPONENT = -4;
/** ...and at or above this one (shortest-precision `%g` decides with precision 6). */
const GO_G_SHORTEST_EXPONENT_PRECISION = 6;
/** Go's `%e` always prints at least two exponent digits (`1e+06`, `1e-07`). */
const GO_EXPONENT_MIN_DIGITS = 2;

/**
 * Go's `%q` for the identifiers a step id can hold. `JSON.stringify` produces
 * the same double-quoted, backslash-escaped form for printable ASCII; the two
 * differ only on non-ASCII and control characters, which no step id carries.
 */
function goQuote(s: string): string {
  return JSON.stringify(s);
}

/**
 * Go's `%g` for a float64: the shortest digits that round-trip, in decimal
 * form when the decimal exponent is in [-4, 6), otherwise as `d.ddde±XX`.
 * `fmt.Sprintf("%g", 0.000001)` is `1e-06`; `%g` of `5` is `5`; of `1e6` is
 * `1e+06`. JS's own `String()` switches at different exponents (-7 / 21) and
 * prints one exponent digit, so it cannot be used directly.
 */
export function goFormatG(x: number): string {
  if (Number.isNaN(x)) return 'NaN';
  if (x === Infinity) return '+Inf';
  if (x === -Infinity) return '-Inf';
  if (x === 0) return Object.is(x, -0) ? '-0' : '0';
  const [mantissa, expText] = x.toExponential().split('e');
  const exp = Number(expText);
  if (exp < GO_G_MIN_DECIMAL_EXPONENT || exp >= GO_G_SHORTEST_EXPONENT_PRECISION) {
    const sign = exp < 0 ? '-' : '+';
    const digits = String(Math.abs(exp)).padStart(GO_EXPONENT_MIN_DIGITS, '0');
    return `${mantissa}e${sign}${digits}`;
  }
  // Inside [-4, 6) JS's String() is already plain decimal with shortest digits.
  return String(x);
}

/**
 * A flow-level `budget:` is parsed, saved and copied into several runtime
 * option fields, none of which anything reads: the reference ran a hermetic
 * mission with `budget: 0.000001` against $2 of mock spend and it COMPLETED.
 * The ceiling that does run is `billing.max_credits`, and the message says how
 * far it reaches, because "use max_credits instead" alone would suggest it
 * bounds every step.
 *
 * `budget: 0` warns too: it reads as "no spend allowed", which is the most
 * dangerous thing to believe about a field that does nothing. Only the
 * top-level key counts — the reference embeds its constraints inline, so a
 * `budget` nested under some other mapping is not this field.
 */
function warnIfBudgetUnenforced(flow: Flow, issues: Issues): void {
  const budget: unknown = flow.budget;
  if (typeof budget !== 'number') return;
  const currency =
    isString(flow.currency) && flow.currency !== '' ? flow.currency : DEFAULT_CURRENCY;
  issues.warn({
    field: FIELD_BUDGET,
    message: `budget: ${goFormatG(budget)} is never enforced: no part of the engine reads it, so a mission is not stopped at this figure. The spend ceiling that IS enforced is billing.max_credits (in credits, not ${currency}): it caps the mission's credit reservation and refuses further agentic turns (agentic ai://, exons://, the orchestrator) once reached. Plain chat steps and flow:// sub-flows are not checked against it. Set billing.max_credits, or remove budget.`,
    code: CODE_FLOW_BUDGET_UNENFORCED,
  });
}

function maxRetriesMessage(count: number, owner: string): string {
  return `max_retries: ${count} on ${owner} is never read: the retry engine takes its retry count only from error_strategy.max_retries (or, without one, from the error category's default). Move it into ${owner}'s error_strategy, e.g. error_strategy: { action: "retry", max_retries: ${count} }, or remove it.`;
}

/**
 * The retry engine reads `error_strategy.max_retries` and nothing else, so a
 * `max_retries:` one level UP — on the flow, or directly on a step — changes
 * nothing. The reference measured an always-failing step making the same 2
 * attempts with no config, with step `max_retries` 0 or 3, and with flow
 * `max_retries` 0; and 1 attempt with `error_strategy: {action: retry,
 * max_retries: 1}`.
 *
 * `error_strategy.max_retries` (flow or step level) is the WORKING key and
 * must never warn — that is the false positive this rule exists to avoid.
 * Loop sub-steps are not walked: their type in the reference has no
 * `max_retries` field, so there is no second step table to check.
 */
function warnIfMaxRetriesUnread(flow: Flow, issues: Issues): void {
  const flowLevel: unknown = flow.max_retries;
  if (typeof flowLevel === 'number' && Number.isInteger(flowLevel)) {
    issues.warn({
      field: FIELD_MAX_RETRIES,
      message: maxRetriesMessage(flowLevel, OWNER_FLOW),
      code: CODE_MAX_RETRIES_UNREAD,
    });
  }
  const steps = flow.steps;
  if (!isRecord(steps)) return;
  for (const [stepID, rawStep] of Object.entries(steps)) {
    if (!isRecord(rawStep)) continue;
    const stepLevel = rawStep.max_retries;
    if (typeof stepLevel !== 'number' || !Number.isInteger(stepLevel)) continue;
    issues.warn({
      field: `steps.${stepID}.${FIELD_MAX_RETRIES}`,
      message: maxRetriesMessage(stepLevel, `step ${goQuote(stepID)}`),
      code: CODE_MAX_RETRIES_UNREAD,
      stepId: stepID,
    });
  }
}

export function validateUnreadLimits(flow: Flow, issues: Issues): void {
  warnIfBudgetUnenforced(flow, issues);
  warnIfMaxRetriesUnread(flow, issues);
}
