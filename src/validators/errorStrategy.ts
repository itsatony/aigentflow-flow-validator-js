// Flow-level and per-step `error_strategy` validation.
//
// Mirrors `validateErrorStrategy` (parser.go): action enum, goto target
// existence, max_delay duration, backoff_multiplier > 0, retry_on categories.

import type { ErrorStrategyDefinition, Flow } from '../types.js';
import { ERROR_STRATEGY_ACTIONS, RETRY_ON_CATEGORIES } from '../spec/index.js';
import { Issues, isNumber, isRecord, isString, isValidGoDuration } from './util.js';

const ACTION_GOTO = 'goto';

function validateOne(
  strategy: ErrorStrategyDefinition,
  steps: Record<string, unknown>,
  field: string,
  stepID: string | undefined,
  issues: Issues,
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

  if (
    isString(strategy.max_delay) &&
    strategy.max_delay !== '' &&
    !isValidGoDuration(strategy.max_delay)
  ) {
    issues.error({
      field: `${field}.max_delay`,
      message: `Invalid max_delay duration '${strategy.max_delay}'`,
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

export function validateErrorStrategies(flow: Flow, issues: Issues): void {
  const steps = isRecord(flow.steps) ? flow.steps : {};

  if (isRecord(flow.error_strategy)) {
    validateOne(
      flow.error_strategy as ErrorStrategyDefinition,
      steps,
      'error_strategy',
      undefined,
      issues,
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
      );
    }
  }
}
