// Flow-level and per-step `error_strategy` validation.
//
// Mirrors `validateErrorStrategy` (parser.go): action enum, goto target
// existence, max_delay duration, backoff_multiplier > 0, retry_on categories —
// plus `unreachable_error_goto` (validation.go, AIF v2.651.0 / DC-FORGE-81) and
// `loop_substep_error_goto_ignored` (validation.go, AIF v2.652.0 / DC-FORGE-82).

import type { ErrorStrategyDefinition, Flow } from '../types.js';
import { ERROR_STRATEGY_ACTIONS, RETRY_ON_CATEGORIES } from '../spec/index.js';
import {
  Issues,
  isNumber,
  isRecord,
  isString,
  isValidGoDuration,
  scalarTextAt,
  type ScalarSources,
} from './util.js';

const ACTION_GOTO = 'goto';

function validateOne(
  strategy: ErrorStrategyDefinition,
  steps: Record<string, unknown>,
  field: string,
  stepID: string | undefined,
  issues: Issues,
  sources: ScalarSources | undefined,
): void {
  const action = strategy.action;
  if (
    action !== undefined &&
    action !== '' &&
    isString(action) &&
    !ERROR_STRATEGY_ACTIONS.has(action)
  ) {
    issues.error({
      field: `${field}.action`,
      message: `Invalid error_strategy action '${action}'`,
      code: 'invalid_error_strategy_action',
      ...(stepID ? { stepId: stepID } : {}),
      suggestion: `Use one of: ${[...ERROR_STRATEGY_ACTIONS].join(', ')}`,
    });
  }

  if (action === ACTION_GOTO) {
    const goto = strategy.goto_step;
    if (goto === undefined || goto === '' || !isString(goto)) {
      issues.error({
        field: `${field}.goto_step`,
        message: "error_strategy action 'goto' requires a 'goto_step'",
        code: 'goto_step_missing',
        ...(stepID ? { stepId: stepID } : {}),
      });
    } else if (!(goto in steps)) {
      issues.error({
        field: `${field}.goto_step`,
        message: `Referenced step '${goto}' in error_strategy does not exist`,
        code: 'step_not_found',
        ...(stepID ? { stepId: stepID } : {}),
      });
    }
  }

  // A `goto_step` the action can never take. The engine switches on `action`
  // and reads `goto_step` in the `goto` branch ONLY; `retry`, `fail` and an
  // absent action all fall through to failing the mission. The check above only
  // asks whether the target EXISTS, and only once the action already is `goto` —
  // so the one combination that silently does nothing went unasked about.
  //
  // Not hypothetical: both of AIF's bundled example flows declared
  // `action: "retry"` beside a `goto_step:` naming an error handler, so neither
  // handler was reachable at all.
  //
  // WARNING, not error, matching the reference: it is consulted at the RUN door
  // over flows that are already stored, and the declaration is INERT rather than
  // fatal — the run does not die, it takes a different path.
  if (action !== ACTION_GOTO && isString(strategy.goto_step) && strategy.goto_step !== '') {
    const shown =
      action === undefined || action === '' ? '(absent, defaults to fail)' : String(action);
    issues.warn({
      field: `${field}.goto_step`,
      message: `goto_step '${strategy.goto_step}' on ${stepID ? `step '${stepID}'` : 'the flow-level error_strategy'} can never be taken: the engine reads goto_step only when action is "goto", and this action is '${shown}'`,
      code: 'unreachable_error_goto',
      ...(stepID ? { stepId: stepID } : {}),
      suggestion:
        'Set action: "goto" (retries still apply through max_retries), or remove goto_step',
    });
  }

  // A Go `string` field, filled from ANY scalar by its source text: `max_delay:
  // 100` is "100" (no unit) and refused, as is `0.0`; `0` saves.
  const maxDelay = scalarTextAt(strategy.max_delay, `${field}.max_delay`, sources);
  if (maxDelay !== null && maxDelay !== '' && !isValidGoDuration(maxDelay)) {
    issues.error({
      field: `${field}.max_delay`,
      message: `Invalid max_delay duration '${maxDelay}'`,
      code: 'invalid_duration',
      ...(stepID ? { stepId: stepID } : {}),
    });
  }

  if (
    isString(strategy.retry_delay) &&
    strategy.retry_delay !== '' &&
    !isValidGoDuration(strategy.retry_delay)
  ) {
    issues.warn({
      field: `${field}.retry_delay`,
      message: `retry_delay '${strategy.retry_delay}' is not a valid Go duration`,
      code: 'invalid_duration',
      ...(stepID ? { stepId: stepID } : {}),
    });
  }

  if (strategy.backoff_multiplier !== undefined) {
    if (!isNumber(strategy.backoff_multiplier) || strategy.backoff_multiplier <= 0) {
      issues.error({
        field: `${field}.backoff_multiplier`,
        message: `backoff_multiplier must be > 0, got ${strategy.backoff_multiplier}`,
        code: 'invalid_backoff_multiplier',
        ...(stepID ? { stepId: stepID } : {}),
      });
    }
  }

  if (Array.isArray(strategy.retry_on)) {
    strategy.retry_on.forEach((cat: unknown, i: number) => {
      if (!isString(cat) || !RETRY_ON_CATEGORIES.has(cat)) {
        issues.error({
          field: `${field}.retry_on[${i}]`,
          message: `Invalid retry_on category '${String(cat)}'`,
          code: 'invalid_retry_on_category',
          ...(stepID ? { stepId: stepID } : {}),
          suggestion: `Use one of: ${[...RETRY_ON_CATEGORIES].join(', ')}`,
        });
      }
    });
  }
}

export function validateErrorStrategies(flow: Flow, issues: Issues, sources?: ScalarSources): void {
  const steps = isRecord(flow.steps) ? flow.steps : {};

  if (isRecord(flow.error_strategy)) {
    validateOne(
      flow.error_strategy as ErrorStrategyDefinition,
      steps,
      'error_strategy',
      undefined,
      issues,
      sources,
    );
  }

  for (const [stepID, step] of Object.entries(steps)) {
    if (!isRecord(step)) continue;
    if (isRecord(step.error_strategy)) {
      validateOne(
        step.error_strategy as ErrorStrategyDefinition,
        steps,
        `steps.${stepID}.error_strategy`,
        stepID,
        issues,
        sources,
      );
    }
    validateLoopBodyErrorGoto(step, stepID, issues);
  }
}

// A loop BODY is a second step table, and the walk above never entered it —
// which is how the reference's own DC-FORGE-81 check missed this. Inside one,
// `goto_step` is unreachable under EVERY action, so it is a different finding
// from `unreachable_error_goto`: that one is fixed by writing `action: "goto"`,
// and this one is not fixable in place at all.
//
// `executeLoopStep`'s failure switch has exactly two arms — `continue` (skip to
// the next sub-step) and a default that aborts the whole loop step — so `goto`
// lands in the default and the loop FAILS. The strategy the author chose to
// avoid failing is the one that fails.
//
// Deliberately NOT routed through validateOne: the reference's parser does not
// run its error_strategy checks over loop sub-steps at all, and an oracle that
// refuses shapes its door accepts is wrong in the more damaging direction.
// Only the new warning is emitted here.
function validateLoopBodyErrorGoto(
  step: Record<string, unknown>,
  stepID: string,
  issues: Issues,
): void {
  if (!isRecord(step.loop)) return;
  const subSteps = (step.loop as Record<string, unknown>).steps;
  if (!Array.isArray(subSteps)) return;

  subSteps.forEach((sub: unknown, i: number) => {
    if (!isRecord(sub)) return;
    const strategy = sub.error_strategy;
    if (!isRecord(strategy)) return;
    const goto = (strategy as ErrorStrategyDefinition).goto_step;
    if (!isString(goto) || goto === '') return;

    const subID = isString(sub.id) && sub.id !== '' ? sub.id : `[${i}]`;
    issues.warn({
      field: `steps.${stepID}.loop.steps.${subID}.error_strategy.goto_step`,
      message: `goto_step '${goto}' on loop step '${stepID}'s sub-step '${subID}' error_strategy is never read: a loop body honours only action "continue" (skip to the next sub-step) and fail. Any other action, including "goto", aborts the whole loop step — which then routes through the LOOP step's own error_strategy.`,
      code: 'loop_substep_error_goto_ignored',
      stepId: stepID,
      suggestion: `Put the goto_step on the loop step '${stepID}' itself, or use action: "continue" here`,
    });
  });
}
