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
import { Issues, isInteger, isNumber, isRecord } from './util.js';

const TYPE_ENUM = 'enum';
const TYPE_NUMBER = 'number';
const TYPE_ARRAY_OF_STRINGS = 'array_of_strings';
const TYPE_FILE = 'file';

function fieldPath(schemaPath: string, i: number): string {
  return `${schemaPath}.fields[${i}]`;
}

function validateField(
  f: InputSchemaField,
  schemaPath: string,
  i: number,
  seen: Map<string, number>,
  issues: Issues,
): void {
  const base = fieldPath(schemaPath, i);
  // `name`, `type` and `pattern` are Go `string` fields: `name: 5` is the name
  // "5", `type: 1` the unknown type "1".
  const name = issues.stringOf(f, 'name', base);
  const shownName = name ?? String(f.name);
  const pattern = issues.stringOf(f, 'pattern', base);

  // Name + duplicate detection.
  if (name === null || !INPUT_SCHEMA.fieldNamePattern.test(name)) {
    issues.error({
      field: base,
      message: `input_schema field name '${shownName}' is invalid (must match ${INPUT_SCHEMA.fieldNamePattern.source})`,
      code: 'input_schema_invalid_field_name',
    });
  } else if (seen.has(name)) {
    issues.error({
      field: base,
      message: `Duplicate input_schema field name '${name}' (first declared at index ${seen.get(name)})`,
      code: 'input_schema_duplicate_field_name',
    });
  } else {
    seen.set(name, i);
  }

  // Type — bail on per-type checks if unknown.
  const type = issues.stringOf(f, 'type', base);
  if (type === null || !INPUT_SCHEMA.types.has(type)) {
    issues.error({
      field: `${base}.type`,
      message: `Unknown input_schema field type '${type ?? String(f.type)}'`,
      code: 'input_schema_unknown_type',
      suggestion: `Use one of: ${[...INPUT_SCHEMA.types].join(', ')}`,
    });
    return;
  }

  // Per-type constraint sanity.
  if (type === TYPE_ENUM && (!Array.isArray(f.enum) || f.enum.length === 0)) {
    issues.error({
      field: `${base}.enum`,
      message: `enum field '${shownName}' must list at least one allowed value`,
      code: 'input_schema_enum_empty',
    });
  }
  if (isNumber(f.min) && isNumber(f.max) && f.min > f.max) {
    issues.error({
      field: `${base}`,
      message: `field '${shownName}': min (${f.min}) must be <= max (${f.max})`,
      code: 'input_schema_invalid_range',
    });
  }
  if (isInteger(f.min_length) && isInteger(f.max_length) && f.min_length > f.max_length) {
    issues.error({
      field: `${base}`,
      message: `field '${shownName}': min_length (${f.min_length}) must be <= max_length (${f.max_length})`,
      code: 'input_schema_invalid_range',
    });
  }
  if (isInteger(f.min_items) && isInteger(f.max_items) && f.min_items > f.max_items) {
    issues.error({
      field: `${base}`,
      message: `field '${shownName}': min_items (${f.min_items}) must be <= max_items (${f.max_items})`,
      code: 'input_schema_invalid_range',
    });
  }

  // Constraint-to-type compatibility.
  const stringy = INPUT_SCHEMA.stringTypes.has(type);
  const mismatch = (constraint: string): void =>
    issues.error({
      field: `${base}.${constraint}`,
      message: `constraint '${constraint}' is not meaningful for field '${shownName}' of type '${type}'`,
      code: 'input_schema_constraint_type_mismatch',
    });
  if (!stringy) {
    if (f.min_length !== undefined) mismatch('min_length');
    if (f.max_length !== undefined) mismatch('max_length');
    if (pattern !== null && pattern !== '') mismatch('pattern');
  }
  if (type !== TYPE_NUMBER) {
    if (f.min !== undefined) mismatch('min');
    if (f.max !== undefined) mismatch('max');
  }
  if (type !== TYPE_ARRAY_OF_STRINGS) {
    if (f.min_items !== undefined) mismatch('min_items');
    if (f.max_items !== undefined) mismatch('max_items');
  }
  if (type !== TYPE_FILE) {
    if (Array.isArray(f.accept) && f.accept.length > 0) mismatch('accept');
    if (f.max_size !== undefined) mismatch('max_size');
  }
  if (type !== TYPE_ENUM && Array.isArray(f.enum) && f.enum.length > 0) mismatch('enum');

  // Constraint value caps.
  const cap = (constraint: string, val: number): void =>
    issues.error({
      field: `${base}.${constraint}`,
      message: `constraint '${constraint}' (${val}) for field '${shownName}' exceeds the maximum of ${INPUT_SCHEMA.maxConstraintValue}`,
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
    if (!issues.nonEmptyStringOf(vw, 'field', `${base}.visible_when`)) {
      issues.error({
        field: `${base}.visible_when`,
        message: `field '${shownName}': visible_when requires a 'field'`,
        code: 'input_schema_visible_when_no_predicate',
      });
    } else if (hasEquals === hasIn) {
      issues.error({
        field: `${base}.visible_when`,
        message: `field '${shownName}': visible_when requires exactly one of 'equals' or 'in'`,
        code: 'input_schema_visible_when_no_predicate',
      });
    }
  }

  // Pattern length + compilation.
  if (pattern !== null && pattern !== '') {
    if (pattern.length > INPUT_SCHEMA.maxPatternLength) {
      issues.error({
        field: `${base}.pattern`,
        message: `field '${shownName}': pattern length ${pattern.length} exceeds the maximum of ${INPUT_SCHEMA.maxPatternLength}`,
        code: 'input_schema_pattern_too_long',
      });
    } else {
      try {
        new RegExp(pattern);
      } catch (e) {
        issues.error({
          field: `${base}.pattern`,
          message: `field '${shownName}': invalid pattern: ${e instanceof Error ? e.message : String(e)}`,
          code: 'input_schema_invalid_pattern',
        });
      }
    }
  }
}

function lintFieldOrdering(fields: InputSchemaField[], schemaPath: string, issues: Issues): void {
  let firstParametricIdx = -1;
  let firstParametricName = '';
  let firstParametricType = '';
  fields.forEach((f, i) => {
    if (!isRecord(f)) return;
    const type = issues.stringOf(f, 'type', fieldPath(schemaPath, i));
    if (type === null) return;
    const name = issues.stringOf(f, 'name', fieldPath(schemaPath, i)) ?? `#${i}`;
    if (firstParametricIdx === -1 && INPUT_SCHEMA.parametricTypes.has(type)) {
      firstParametricIdx = i;
      firstParametricName = name;
      firstParametricType = type;
      return;
    }
    if (type === TYPE_FILE && firstParametricIdx !== -1) {
      issues.warn({
        field: fieldPath(schemaPath, i),
        message: `file field '${name}' is declared after parametric field '${firstParametricName}' (${firstParametricType}); consider moving file fields first`,
        code: 'input_schema_file_after_parametric',
      });
    }
  });
}

/**
 * Validate one `InputSchema`-shaped definition at an arbitrary base path.
 *
 * Mirrors the Go `ValidateInputSchemaDefinition`, which is reused verbatim for
 * both `flow.input_schema` and a step's `output_schema` (DC-CP-7). The emitted
 * `code`s are therefore the shared `input_schema_*` set regardless of the site;
 * only the `field` path differs (`schemaPath`).
 */
export function validateSchemaDefinition(
  schema: unknown,
  schemaPath: string,
  issues: Issues,
): void {
  if (schema === undefined || schema === null) return;
  if (!isRecord(schema)) {
    issues.error({
      field: schemaPath,
      message: `${schemaPath} must be a mapping`,
      code: 'invalid_type',
    });
    return;
  }
  const s = schema as InputSchema;

  if (s.version !== INPUT_SCHEMA_VERSION) {
    issues.error({
      field: `${schemaPath}.version`,
      message: `${schemaPath} version ${String(s.version)} is not supported (expected ${INPUT_SCHEMA_VERSION})`,
      code: 'input_schema_invalid_version',
    });
  }

  const fields = s.fields;
  if (fields === undefined || fields === null) return;
  if (!Array.isArray(fields)) {
    issues.error({
      field: `${schemaPath}.fields`,
      message: `${schemaPath}.fields must be a list`,
      code: 'invalid_type',
    });
    return;
  }

  // Resolution index for visible_when (forward references allowed).
  const allNames = new Set<string>();
  fields.forEach((f: unknown, i: number) => {
    if (!isRecord(f)) return;
    const name = issues.stringOf(f, 'name', fieldPath(schemaPath, i));
    if (name !== null && name !== '') allNames.add(name);
  });

  const seen = new Map<string, number>();
  fields.forEach((rawField, i) => {
    if (!isRecord(rawField)) {
      issues.error({
        field: fieldPath(schemaPath, i),
        message: `${schemaPath} field at index ${i} must be a mapping`,
        code: 'invalid_type',
      });
      return;
    }
    validateField(rawField as InputSchemaField, schemaPath, i, seen, issues);
  });

  // Second pass: visible_when references must resolve.
  fields.forEach((rawField, i) => {
    if (!isRecord(rawField)) return;
    const f = rawField as InputSchemaField;
    if (!isRecord(f.visible_when)) return;
    const vw = f.visible_when as VisibleWhenPredicate;
    const ref = issues.stringOf(vw, 'field', `${fieldPath(schemaPath, i)}.visible_when`);
    if (ref !== null && ref !== '' && !allNames.has(ref)) {
      const name = issues.stringOf(f, 'name', fieldPath(schemaPath, i)) ?? `#${i}`;
      issues.error({
        field: `${fieldPath(schemaPath, i)}.visible_when.field`,
        message: `field '${name}': visible_when references unknown field '${ref}'`,
        code: 'input_schema_visible_when_unknown_field',
      });
    }
  });

  lintFieldOrdering(fields as InputSchemaField[], schemaPath, issues);
}

export function validateInputSchema(flow: Flow, issues: Issues): void {
  validateSchemaDefinition(flow.input_schema, 'input_schema', issues);
}
