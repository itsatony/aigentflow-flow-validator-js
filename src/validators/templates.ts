// Template syntax validation across a step's templated fields.
//
// Mirrors `validateTemplates` / `validateStepTemplates` / `countTemplates`
// (validation.go): walk string leaves of `query`, `pre_processing`,
// `post_processing`, and `next.conditions[].if`; anything containing `{{` is
// run through the Go-template syntax checker. Runtime field-resolution
// warnings (the reference's execution pass) are intentionally NOT reproduced —
// see PARITY.md.

import type {
  Flow,
  NextCondition,
  NextLogicDefinition,
  StepDefinition,
  ValidateOptions,
} from '../types.js';
import { TEMPLATE_FUNCTIONS } from '../spec/index.js';
import { checkGoTemplateSyntax } from '../template/gotmpl-syntax.js';
import { Issues, isArray, isRecord, isString } from './util.js';

/** The optional guard key on a processing operation; every other key is the op name. */
const PROCESSING_OP_GUARD_KEY = 'if';

function isTemplate(value: string): boolean {
  return value.includes('{{');
}

/** Counter threaded through the walk for the summary statistics. */
interface TemplateStats {
  found: number;
  syntaxErrors: number;
}

function checkTemplateString(
  value: string,
  field: string,
  stepID: string,
  issues: Issues,
  stats: TemplateStats,
  opts: ValidateOptions,
): void {
  if (!isTemplate(value)) return;
  stats.found += 1;
  const errors = checkGoTemplateSyntax(value, {
    knownFunctions: TEMPLATE_FUNCTIONS,
    strictFunctions: opts.strictRegistries === true,
  });
  for (const err of errors) {
    if (err.isFunctionError) {
      issues.error({
        field,
        message: `Template ${err.message}`,
        code: 'template_function_unknown',
        stepId: stepID,
        context: `Template: ${value}`,
      });
    } else {
      stats.syntaxErrors += 1;
      issues.error({
        field,
        message: `Template syntax error: ${err.message}`,
        code: 'template_syntax_error',
        stepId: stepID,
        context: `Template: ${value}`,
        suggestion: 'Check Go template syntax: https://pkg.go.dev/text/template',
      });
    }
  }
}

/** Walk string leaves of an arbitrary value, mirroring walkObjectRecursive. */
function walkStrings(
  basePath: string,
  value: unknown,
  stepID: string,
  issues: Issues,
  stats: TemplateStats,
  opts: ValidateOptions,
  check: boolean,
): void {
  if (isString(value)) {
    if (check) {
      checkTemplateString(value, basePath, stepID, issues, stats, opts);
    } else if (isTemplate(value)) {
      stats.found += 1;
    }
    return;
  }
  if (isArray(value)) {
    value.forEach((item, i) => {
      walkStrings(`${basePath}[${i}]`, item, stepID, issues, stats, opts, check);
    });
    return;
  }
  if (isRecord(value)) {
    for (const [key, v] of Object.entries(value)) {
      walkStrings(`${basePath}.${key}`, v, stepID, issues, stats, opts, check);
    }
  }
}

/**
 * Walk one processing operation, producing the field paths the REFERENCE produces.
 *
 * A processing operation is written as a single-key map — `- data.set: { … }` —
 * plus an optional `if:` guard. Go's `ProcessingOperationDefinition` unmarshals
 * that key into `OperationType` and its body into an INLINE `Config`, so the
 * reference reports `…post_processing[0].<configKey>` and `…post_processing[0].if`.
 * Walking the raw record instead inserts the operation name as a path segment
 * (`…post_processing[0].data.set.<configKey>`), which is the same finding under a
 * different address.
 *
 * DC-FORGE-76 note: until AIgentFlow v2.646.0 the reference validated these blocks
 * not at all — `validateProcessingOperation` asserted a type neither call site
 * passed and returned silently — so this walker was stricter than the reference
 * it ports for its whole life. It is now the same check, and this alignment makes
 * it the same address too.
 */
function walkProcessingOperation(
  basePath: string,
  op: unknown,
  stepID: string,
  issues: Issues,
  stats: TemplateStats,
  opts: ValidateOptions,
): void {
  if (!isRecord(op)) {
    walkStrings(basePath, op, stepID, issues, stats, opts, true);
    return;
  }
  for (const [key, value] of Object.entries(op)) {
    if (key === PROCESSING_OP_GUARD_KEY) {
      walkStrings(`${basePath}.${PROCESSING_OP_GUARD_KEY}`, value, stepID, issues, stats, opts, true);
      continue;
    }
    // The operation name is absorbed into OperationType; its body is inline.
    walkStrings(basePath, value, stepID, issues, stats, opts, true);
  }
}

export function validateTemplates(
  flow: Flow,
  issues: Issues,
  opts: ValidateOptions,
): TemplateStats {
  const stats: TemplateStats = { found: 0, syntaxErrors: 0 };
  const steps = flow.steps;
  if (!isRecord(steps)) return stats;

  for (const [stepID, rawStep] of Object.entries(steps)) {
    if (!isRecord(rawStep)) continue;
    const step = rawStep as StepDefinition;

    if (step.query !== undefined) {
      walkStrings(`steps.${stepID}.query`, step.query, stepID, issues, stats, opts, true);
    }
    if (isArray(step.pre_processing)) {
      step.pre_processing.forEach((op, i) => {
        walkProcessingOperation(
          `steps.${stepID}.pre_processing[${i}]`, op, stepID, issues, stats, opts);
      });
    }
    if (isArray(step.post_processing)) {
      step.post_processing.forEach((op, i) => {
        walkProcessingOperation(
          `steps.${stepID}.post_processing[${i}]`, op, stepID, issues, stats, opts);
      });
    }
    // response_expectation templates are counted (matching countTemplates) but
    // not syntax-checked (matching validateStepTemplates).
    if (step.response_expectation !== undefined) {
      walkStrings(
        `steps.${stepID}.response_expectation`,
        step.response_expectation,
        stepID,
        issues,
        stats,
        opts,
        false,
      );
    }
    // next.conditions[].if expressions are syntax-checked (not counted).
    const next = step.next;
    if (isRecord(next) && isArray((next as NextLogicDefinition).conditions)) {
      (next as NextLogicDefinition).conditions!.forEach(
        (cond: NextCondition | unknown, i: number) => {
          if (!isRecord(cond)) return;
          const ifExpr = (cond as NextCondition).if;
          if (isString(ifExpr) && ifExpr !== '') {
            // Conditions are counted toward found so a syntax error there does
            // not push templatesValid above templatesFound.
            stats.found += 1;
            checkTemplateString(
              ifExpr,
              `steps.${stepID}.next.conditions[${i}].if`,
              stepID,
              issues,
              stats,
              opts,
            );
          }
        },
      );
    }
  }

  return stats;
}
