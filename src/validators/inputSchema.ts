// `input_schema` definition validation + the file-ordering lint.
//
// Mirrors `ValidateInputSchemaDefinition` + `LintInputSchemaFieldOrdering`
// (input_schema.go). This validates the SCHEMA DEFINITION only — payload
// validation (`ValidateInputAgainstSchema`) is runtime and out of scope.
//
// Note: pattern compilation uses the JS regex engine, not Go RE2; a pattern
// valid in one engine but not the other is a known, documented divergence.

import type { Flow, InputSchema, InputSchemaField, VisibleWhenPredicate } from '../types.js';
import { INPUT_SCHEMA, INPUT_SCHEMA_VERSION } from '../spec/index.js';
import { Issues, isInteger, isNumber, isRecord, isString } from './util.js';

const TYPE_ENUM = 'enum';
const TYPE_NUMBER = 'number';
const TYPE_ARRAY_OF_STRINGS = 'array_of_strings';
const TYPE_FILE = 'file';

function fieldPath(i: number): string {
  return `input_schema.fields[${i}]`;
}

function validateField(
  f: InputSchemaField,
  i: number,
  seen: Map<string, number>,
  issues: Issues,
): void {
  const base = fieldPath(i);

  // Name + duplicate detection.
  if (!isString(f.name) || !INPUT_SCHEMA.fieldNamePattern.test(f.name)) {
    issues.error({
      field: base,
      message: `input_schema field name '${String(f.name)}' is invalid (must match ${INPUT_SCHEMA.fieldNamePattern.source})`,
      code: 'input_schema_invalid_field_name',
    });
  } else if (seen.has(f.name)) {
    issues.error({
      field: base,
      message: `Duplicate input_schema field name '${f.name}' (first declared at index ${seen.get(f.name)})`,
      code: 'input_schema_duplicate_field_name',
    });
  } else {
    seen.set(f.name, i);
  }

  // Type — bail on per-type checks if unknown.
  if (!isString(f.type) || !INPUT_SCHEMA.types.has(f.type)) {
    issues.error({
      field: `${base}.type`,
      message: `Unknown input_schema field type '${String(f.type)}'`,
      code: 'input_schema_unknown_type',
      suggestion: `Use one of: ${[...INPUT_SCHEMA.types].join(', ')}`,
    });
    return;
  }

  // Per-type constraint sanity.
  if (f.type === TYPE_ENUM && (!Array.isArray(f.enum) || f.enum.length === 0)) {
    issues.error({
      field: `${base}.enum`,
      message: `enum field '${f.name}' must list at least one allowed value`,
      code: 'input_schema_enum_empty',
    });
  }
  if (isNumber(f.min) && isNumber(f.max) && f.min > f.max) {
    issues.error({
      field: `${base}`,
      message: `field '${f.name}': min (${f.min}) must be <= max (${f.max})`,
      code: 'input_schema_invalid_range',
    });
  }
  if (isInteger(f.min_length) && isInteger(f.max_length) && f.min_length > f.max_length) {
    issues.error({
      field: `${base}`,
      message: `field '${f.name}': min_length (${f.min_length}) must be <= max_length (${f.max_length})`,
      code: 'input_schema_invalid_range',
    });
  }
  if (isInteger(f.min_items) && isInteger(f.max_items) && f.min_items > f.max_items) {
    issues.error({
      field: `${base}`,
      message: `field '${f.name}': min_items (${f.min_items}) must be <= max_items (${f.max_items})`,
      code: 'input_schema_invalid_range',
    });
  }

  // Constraint-to-type compatibility.
  const stringy = INPUT_SCHEMA.stringTypes.has(f.type);
  const mismatch = (constraint: string): void =>
    issues.error({
      field: `${base}.${constraint}`,
      message: `constraint '${constraint}' is not meaningful for field '${f.name}' of type '${f.type}'`,
      code: 'input_schema_constraint_type_mismatch',
    });
  if (!stringy) {
    if (f.min_length !== undefined) mismatch('min_length');
    if (f.max_length !== undefined) mismatch('max_length');
    if (f.pattern !== undefined && f.pattern !== '') mismatch('pattern');
  }
  if (f.type !== TYPE_NUMBER) {
    if (f.min !== undefined) mismatch('min');
    if (f.max !== undefined) mismatch('max');
  }
  if (f.type !== TYPE_ARRAY_OF_STRINGS) {
    if (f.min_items !== undefined) mismatch('min_items');
    if (f.max_items !== undefined) mismatch('max_items');
  }
  if (f.type !== TYPE_FILE) {
    if (Array.isArray(f.accept) && f.accept.length > 0) mismatch('accept');
    if (f.max_size !== undefined) mismatch('max_size');
  }
  if (f.type !== TYPE_ENUM && Array.isArray(f.enum) && f.enum.length > 0) mismatch('enum');

  // Constraint value caps.
  const cap = (constraint: string, val: number): void =>
    issues.error({
      field: `${base}.${constraint}`,
      message: `constraint '${constraint}' (${val}) for field '${f.name}' exceeds the maximum of ${INPUT_SCHEMA.maxConstraintValue}`,
      code: 'input_schema_constraint_out_of_range',
    });
  if (isInteger(f.min_length) && f.min_length > INPUT_SCHEMA.maxConstraintValue)
    cap('min_length', f.min_length);
  if (isInteger(f.max_length) && f.max_length > INPUT_SCHEMA.maxConstraintValue)
    cap('max_length', f.max_length);
  if (isInteger(f.min_items) && f.min_items > INPUT_SCHEMA.maxConstraintValue)
    cap('min_items', f.min_items);
  if (isInteger(f.max_items) && f.max_items > INPUT_SCHEMA.maxConstraintValue)
    cap('max_items', f.max_items);

  // visible_when first-pass predicate shape.
  if (isRecord(f.visible_when)) {
    const vw = f.visible_when as VisibleWhenPredicate;
    const hasEquals = vw.equals !== undefined && vw.equals !== null;
    const hasIn = Array.isArray(vw.in) && vw.in.length > 0;
    if (!isString(vw.field) || vw.field === '') {
      issues.error({
        field: `${base}.visible_when`,
        message: `field '${f.name}': visible_when requires a 'field'`,
        code: 'input_schema_visible_when_no_predicate',
      });
    } else if (hasEquals === hasIn) {
      issues.error({
        field: `${base}.visible_when`,
        message: `field '${f.name}': visible_when requires exactly one of 'equals' or 'in'`,
        code: 'input_schema_visible_when_no_predicate',
      });
    }
  }

  // Pattern length + compilation.
  if (isString(f.pattern) && f.pattern !== '') {
    if (f.pattern.length > INPUT_SCHEMA.maxPatternLength) {
      issues.error({
        field: `${base}.pattern`,
        message: `field '${f.name}': pattern length ${f.pattern.length} exceeds the maximum of ${INPUT_SCHEMA.maxPatternLength}`,
        code: 'input_schema_pattern_too_long',
      });
    } else {
      try {
        new RegExp(f.pattern);
      } catch (e) {
        issues.error({
          field: `${base}.pattern`,
          message: `field '${f.name}': invalid pattern: ${e instanceof Error ? e.message : String(e)}`,
          code: 'input_schema_invalid_pattern',
        });
      }
    }
  }
}

function lintFieldOrdering(fields: InputSchemaField[], issues: Issues): void {
  let firstParametricIdx = -1;
  let firstParametricName = '';
  let firstParametricType = '';
  fields.forEach((f, i) => {
    if (!isRecord(f) || !isString(f.type)) return;
    if (firstParametricIdx === -1 && INPUT_SCHEMA.parametricTypes.has(f.type)) {
      firstParametricIdx = i;
      firstParametricName = isString(f.name) ? f.name : `#${i}`;
      firstParametricType = f.type;
      return;
    }
    if (f.type === TYPE_FILE && firstParametricIdx !== -1) {
      issues.warn({
        field: fieldPath(i),
        message: `file field '${isString(f.name) ? f.name : `#${i}`}' is declared after parametric field '${firstParametricName}' (${firstParametricType}); consider moving file fields first`,
        code: 'input_schema_file_after_parametric',
      });
    }
  });
}

export function validateInputSchema(flow: Flow, issues: Issues): void {
  const schema = flow.input_schema;
  if (schema === undefined || schema === null) return;
  if (!isRecord(schema)) {
    issues.error({
      field: 'input_schema',
      message: 'input_schema must be a mapping',
      code: 'invalid_type',
    });
    return;
  }
  const s = schema as InputSchema;

  if (s.version !== INPUT_SCHEMA_VERSION) {
    issues.error({
      field: 'input_schema.version',
      message: `input_schema version ${String(s.version)} is not supported (expected ${INPUT_SCHEMA_VERSION})`,
      code: 'input_schema_invalid_version',
    });
  }

  const fields = s.fields;
  if (fields === undefined || fields === null) return;
  if (!Array.isArray(fields)) {
    issues.error({
      field: 'input_schema.fields',
      message: 'input_schema.fields must be a list',
      code: 'invalid_type',
    });
    return;
  }

  // Resolution index for visible_when (forward references allowed).
  const allNames = new Set<string>();
  for (const f of fields) {
    if (isRecord(f) && isString(f.name) && f.name !== '') allNames.add(f.name);
  }

  const seen = new Map<string, number>();
  fields.forEach((rawField, i) => {
    if (!isRecord(rawField)) {
      issues.error({
        field: fieldPath(i),
        message: `input_schema field at index ${i} must be a mapping`,
        code: 'invalid_type',
      });
      return;
    }
    validateField(rawField as InputSchemaField, i, seen, issues);
  });

  // Second pass: visible_when references must resolve.
  fields.forEach((rawField, i) => {
    if (!isRecord(rawField)) return;
    const f = rawField as InputSchemaField;
    if (!isRecord(f.visible_when)) return;
    const ref = (f.visible_when as VisibleWhenPredicate).field;
    if (isString(ref) && ref !== '' && !allNames.has(ref)) {
      issues.error({
        field: `${fieldPath(i)}.visible_when.field`,
        message: `field '${isString(f.name) ? f.name : `#${i}`}': visible_when references unknown field '${ref}'`,
        code: 'input_schema_visible_when_unknown_field',
      });
    }
  });

  lintFieldOrdering(fields as InputSchemaField[], issues);
}
