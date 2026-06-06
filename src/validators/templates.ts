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
        walkStrings(`steps.${stepID}.pre_processing[${i}]`, op, stepID, issues, stats, opts, true);
      });
    }
    if (isArray(step.post_processing)) {
      step.post_processing.forEach((op, i) => {
        walkStrings(`steps.${stepID}.post_processing[${i}]`, op, stepID, issues, stats, opts, true);
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
