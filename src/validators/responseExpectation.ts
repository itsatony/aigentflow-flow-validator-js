// Per-step `response_expectation` field validation.
//
// Union of the detailed validator (`validateSemantics` → type must be a known
// data type) and the parser (`ValidateFlow` → array fields require `items`;
// `required` must be a boolean or a string template). See PARITY.md.

import type { Flow, ResponseExpectationField } from '../types.js';
import { DATA_TYPES } from '../spec/index.js';
import { Issues, isRecord, isString } from './util.js';

const TYPE_ARRAY = 'array';

export function validateResponseExpectations(flow: Flow, issues: Issues): void {
  const steps = flow.steps;
  if (!isRecord(steps)) return;

  for (const [stepID, rawStep] of Object.entries(steps)) {
    if (!isRecord(rawStep)) continue;
    const re = rawStep.response_expectation;
    if (re === undefined || re === null) continue;
    if (!isRecord(re)) {
      issues.error({
        field: `steps.${stepID}.response_expectation`,
        message: 'response_expectation must be a mapping',
        code: 'invalid_type',
        stepId: stepID,
      });
      continue;
    }

    for (const [fieldName, rawField] of Object.entries(re)) {
      const base = `steps.${stepID}.response_expectation.${fieldName}`;
      if (!isRecord(rawField)) {
        issues.error({
          field: base,
          message: `response_expectation field '${fieldName}' must be a mapping`,
          code: 'invalid_type',
          stepId: stepID,
        });
        continue;
      }
      const field = rawField as ResponseExpectationField;

      if (!isString(field.type) || !DATA_TYPES.has(field.type)) {
        issues.error({
          field: `${base}.type`,
          message: `Invalid data type: ${field.type ?? '(none)'}`,
          code: 'invalid_data_type',
          stepId: stepID,
          suggestion: `Use one of: ${[...DATA_TYPES].join(', ')}`,
        });
      } else if (field.type === TYPE_ARRAY && (field.items === undefined || field.items === null)) {
        issues.error({
          field: `${base}.items`,
          message: `Array field '${fieldName}' in step '${stepID}' must define 'items'`,
          code: 'response_expectation_array_items_missing',
          stepId: stepID,
        });
      }

      if (field.required !== undefined) {
        const t = typeof field.required;
        if (t !== 'boolean' && t !== 'string') {
          issues.error({
            field: `${base}.required`,
            message: `response_expectation.${fieldName}.required must be a boolean or a string template`,
            code: 'invalid_field_value',
            stepId: stepID,
          });
        }
      }
    }
  }
}
