// `expression_functions` validation.
//
// Three layers, all mirrored from the Go reference (parser.go):
//
//  1. `validateExpressionFunctions` — structural: each entry is a mapping with
//     exactly one key, which must be either `package` or `function`, with a
//     non-empty value. Unchanged since the block existed.
//  2. `validateExpressionFunctionCatalog` — the catalog rules: `package:` is
//     refused outright, and a `function:` name outside the fixed catalog is
//     refused. The catalog is compiled into the AIgentFlow binary; nothing is
//     loaded at run time, ever, which is why `package:` can never work.
//  3. `validateExpressionFunctionUsage` — a template action calling an `fn_`
//     name must name a real catalog entry AND be declared by this flow's
//     `expression_functions:` block.
//
// Layers 2 and 3 are refused at the SAVE door upstream; a flow stored before
// the rules existed still RUNS. This validator answers "would this save", so
// both are `error` severity — the same choice already made for the executor-URL
// shape rule. See PARITY.md.

import type { Flow } from '../types.js';
import { EXPRESSION_FUNCTION_CATALOG, EXPRESSION_FUNCTION_NAME_PREFIX } from '../spec/index.js';
import { Issues, isArray, isRecord, isString } from './util.js';

const KEY_PACKAGE = 'package';
const KEY_FUNCTION = 'function';

/** Sorted catalog names, for the "Available:" half of every refusal message. */
const CATALOG_LIST = [...EXPRESSION_FUNCTION_CATALOG].sort().join(', ');

/**
 * One template action, `{{ … }}`. `[\s\S]` rather than `.` so a MULTI-LINE
 * action — which YAML block scalars produce — is matched whole, and non-greedy
 * so two actions on one line stay two actions.
 */
const TEMPLATE_ACTION_PATTERN = /\{\{[\s\S]*?\}\}/g;

/**
 * A catalog-namespaced identifier. Applied ONLY to the text between `{{` and
 * `}}`, so a step description that mentions `fn_slugify` in prose is not read as
 * a call — the same restriction the Go rule carries.
 */
const EXPRESSION_FUNCTION_CALL_PATTERN = new RegExp(
  `\\b${EXPRESSION_FUNCTION_NAME_PREFIX}[A-Za-z0-9_]+`,
  'g',
);

/** Collect the catalog names this flow declares. */
function declaredFunctions(list: unknown): Set<string> {
  const declared = new Set<string>();
  if (!isArray(list)) return declared;
  for (const entry of list) {
    if (!isRecord(entry)) continue;
    const name = entry[KEY_FUNCTION];
    if (isString(name) && name !== '') declared.add(name);
  }
  return declared;
}

/** Structural + catalog rules over the `expression_functions:` block itself. */
function validateDeclarations(list: unknown, issues: Issues): void {
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
      return;
    }

    // `package:` is refused, not ignored. Nothing is loaded at run time, so a
    // flow could never have gotten functions this way — accepting the key in
    // silence is what kept the block inert for so long.
    if (hasPackage) {
      issues.error({
        field: `${field}.${KEY_PACKAGE}`,
        message:
          '`package:` is not supported: expression functions are compiled into AIgentFlow and ' +
          'nothing is loaded at run time. Use `function:` naming a built-in catalog entry instead.',
        code: 'expression_function_package_unsupported',
        context: `Available: ${CATALOG_LIST}`,
        suggestion: 'Replace the entry with { function: "fn_<name>" } from the catalog.',
      });
      return;
    }

    if (!EXPRESSION_FUNCTION_CATALOG.has(value)) {
      issues.error({
        field: `${field}.${KEY_FUNCTION}`,
        message: `expression function '${value}' is not in the built-in catalog`,
        code: 'expression_function_unknown',
        context: `Available: ${CATALOG_LIST}`,
      });
    }
  });
}

/**
 * Walk every string leaf of the document, reporting its dotted path.
 *
 * The Go rule re-serialises the flow struct for the same reason this walks the
 * whole document: template strings live in a dozen unrelated places (step
 * queries, conditions, next-step expressions, output bindings, orchestrator
 * prompts, loop bounds) and a hand-kept field list goes stale the first time a
 * field is added.
 */
function walkStrings(path: string, value: unknown, visit: (path: string, s: string) => void): void {
  if (isString(value)) {
    visit(path, value);
    return;
  }
  if (isArray(value)) {
    value.forEach((item, i) => walkStrings(`${path}[${i}]`, item, visit));
    return;
  }
  if (isRecord(value)) {
    for (const [key, v] of Object.entries(value)) {
      walkStrings(path === '' ? key : `${path}.${key}`, v, visit);
    }
  }
}

/**
 * Refuse a template that CALLS a catalog function this flow did not declare, or
 * an `fn_` name that is not in the catalog at all. This is what makes the
 * `expression_functions:` block load-bearing rather than decorative.
 */
function validateUsage(flow: Flow, declared: Set<string>, issues: Issues): void {
  // One finding per distinct name: a flow that uses fn_slugify in thirty
  // templates has one problem, not thirty.
  const reported = new Set<string>();

  walkStrings('', flow as unknown, (path, text) => {
    if (!text.includes('{{')) return;
    for (const action of text.match(TEMPLATE_ACTION_PATTERN) ?? []) {
      for (const called of action.match(EXPRESSION_FUNCTION_CALL_PATTERN) ?? []) {
        if (reported.has(called)) continue;
        if (!EXPRESSION_FUNCTION_CATALOG.has(called)) {
          reported.add(called);
          issues.error({
            field: path,
            message: `A template calls '${called}', which is not a built-in expression function`,
            code: 'expression_function_unknown_use',
            context: `Available: ${CATALOG_LIST}`,
          });
          continue;
        }
        if (!declared.has(called)) {
          reported.add(called);
          issues.error({
            field: path,
            message: `A template calls '${called}' but the flow does not declare it`,
            code: 'expression_function_undeclared_use',
            suggestion: `Add it: expression_functions: [{ function: "${called}" }]`,
          });
        }
      }
    }
  });
}

export function validateExpressionFunctions(flow: Flow, issues: Issues): void {
  validateDeclarations(flow.expression_functions, issues);
  // The usage scan runs even when the block is absent: a flow that calls an
  // `fn_` function and declares nothing is precisely the case the rule exists
  // for.
  validateUsage(flow, declaredFunctions(flow.expression_functions), issues);
}
