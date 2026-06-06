// `expression_functions` validation.
//
// Mirrors `validateExpressionFunctions` (parser.go): each entry is a mapping
// with exactly one key, which must be either `package` or `function`, with a
// non-empty value.

import type { Flow } from '../types.js';
import { Issues, isRecord, isString } from './util.js';

const KEY_PACKAGE = 'package';
const KEY_FUNCTION = 'function';

export function validateExpressionFunctions(flow: Flow, issues: Issues): void {
  const list = flow.expression_functions;
  if (list === undefined || list === null) return;
  if (!Array.isArray(list)) {
    issues.error({
      field: 'expression_functions',
      message: 'expression_functions must be a list',
      code: 'invalid_type',
    });
    return;
  }

  list.forEach((entry: unknown, i: number) => {
    const field = `expression_functions[${i}]`;
    if (!isRecord(entry)) {
      issues.error({
        field,
        message: 'Each expression_functions entry must be a mapping',
        code: 'invalid_expression_function',
      });
      return;
    }
    const keys = Object.keys(entry);
    if (keys.length !== 1) {
      issues.error({
        field,
        message: 'Each expression_functions entry must have exactly one key (package OR function)',
        code: 'invalid_expression_function',
      });
      return;
    }
    const hasPackage = KEY_PACKAGE in entry;
    const hasFunction = KEY_FUNCTION in entry;
    if (!hasPackage && !hasFunction) {
      issues.error({
        field,
        message: "expression_functions entry must use key 'package' or 'function'",
        code: 'invalid_expression_function',
      });
      return;
    }
    const key = hasPackage ? KEY_PACKAGE : KEY_FUNCTION;
    const value = entry[key];
    if (!isString(value) || value === '') {
      issues.error({
        field: `${field}.${key}`,
        message: `expression_functions '${key}' must have a non-empty value`,
        code: 'invalid_expression_function',
      });
    }
  });
}
