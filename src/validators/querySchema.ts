// Flow-level `query:` input-parameter schema validation.
//
// Mirrors `validateQueryParameters` / `validateProperties` / `validateArrayItems`
// / `validateArrayConstraints` (parser.go). Note: matching the Go reference,
// the *top-level* param type is only required to be non-empty — it is NOT
// constrained to the known data-type set (an unknown top-level type is a
// warning here). Array *item* types ARE constrained, as in Go.

import type { Flow, PropertyDefinition } from '../types.js';
import { DATA_TYPES } from '../spec/index.js';
import { Issues, isInteger, isRecord } from './util.js';

const TYPE_OBJECT = 'object';
const TYPE_ARRAY = 'array';

// Every `type` is a Go `string`, so `type: 1` is the type "1" — unknown, not
// missing. Source spellings are keyed by DOCUMENT path, which the finding paths
// below do not follow (they omit the `properties` segment and write `[item]`),
// so each function also takes `src`, the document path of the definition that
// owns the `items:` / `properties:` it reads.

function validateArrayItems(items: unknown, path: string, src: string, issues: Issues): void {
  if (items === undefined || items === null || !isRecord(items)) {
    issues.error({
      field: path,
      message: `Array '${path}' must define an 'items' schema`,
      code: 'array_items_missing',
    });
    return;
  }
  const def = items as PropertyDefinition;
  const srcItems = `${src}.items`;
  const type = issues.stringOf(def, 'type', srcItems);
  if (type === null || type === '') {
    issues.error({
      field: `${path}.items.type`,
      message: `Array items for '${path}' must define a 'type'`,
      code: 'array_items_type_invalid',
    });
    return;
  }
  if (!DATA_TYPES.has(type)) {
    issues.error({
      field: `${path}.items.type`,
      message: `Array items for '${path}' have invalid type '${type}'`,
      code: 'array_items_type_invalid',
      suggestion: `Use one of: ${[...DATA_TYPES].join(', ')}`,
    });
    return;
  }
  if (type === TYPE_OBJECT) {
    validateProperties(def.properties, `${path}[item]`, srcItems, issues);
  }
  if (type === TYPE_ARRAY) {
    validateArrayItems(def.items, `${path}[item]`, srcItems, issues);
  }
}

function validateProperties(
  properties: unknown,
  parentPath: string,
  src: string,
  issues: Issues,
): void {
  if (properties === undefined || properties === null) return;
  if (!isRecord(properties)) {
    issues.error({
      field: `${parentPath}.properties`,
      message: `properties of '${parentPath}' must be a mapping`,
      code: 'invalid_type',
    });
    return;
  }
  for (const [propName, rawDef] of Object.entries(properties)) {
    const path = `${parentPath}.${propName}`;
    if (!isRecord(rawDef)) {
      issues.error({
        field: path,
        message: `Property '${propName}' must be a mapping`,
        code: 'invalid_type',
      });
      continue;
    }
    const def = rawDef as PropertyDefinition;
    const srcDef = `${src}.properties.${propName}`;
    const type = issues.stringOf(def, 'type', srcDef);
    if (type === null || type === '') {
      issues.error({
        field: `${path}.type`,
        message: `Property '${propName}' in '${parentPath}' is missing a 'type'`,
        code: 'property_type_missing',
      });
      continue;
    }
    if (!DATA_TYPES.has(type)) {
      issues.warn({
        field: `${path}.type`,
        message: `Property '${propName}' has unrecognised type '${type}'`,
        code: 'unknown_data_type',
      });
    }
    if (type === TYPE_OBJECT) {
      validateProperties(def.properties, path, srcDef, issues);
    }
    if (type === TYPE_ARRAY) {
      validateArrayItems(def.items, path, srcDef, issues);
    }
  }
}

function validateArrayConstraints(def: PropertyDefinition, path: string, issues: Issues): void {
  const min = def.min_items;
  const max = def.max_items;
  if (min !== undefined) {
    if (!isInteger(min) || min < 0) {
      issues.error({
        field: `${path}.min_items`,
        message: `min_items for '${path}' must be a non-negative integer`,
        code: 'array_min_items_invalid',
      });
    }
  }
  if (isInteger(min) && isInteger(max) && max < min) {
    issues.error({
      field: `${path}.max_items`,
      message: `max_items (${max}) for '${path}' must be >= min_items (${min})`,
      code: 'array_max_items_invalid',
    });
  }
}

export function validateQuerySchema(flow: Flow, issues: Issues): void {
  const query = flow.query;
  if (query === undefined || query === null) return;
  if (!isRecord(query)) {
    issues.error({
      field: 'query',
      message: 'query must be a mapping of parameter name to definition',
      code: 'invalid_type',
    });
    return;
  }

  for (const [paramName, rawDef] of Object.entries(query)) {
    const path = `query.${paramName}`;
    if (!isRecord(rawDef)) {
      issues.error({
        field: path,
        message: `Query parameter '${paramName}' must be a mapping`,
        code: 'invalid_type',
      });
      continue;
    }
    const def = rawDef as PropertyDefinition;
    const type = issues.stringOf(def, 'type', path);
    if (type === null || type === '') {
      issues.error({
        field: `${path}.type`,
        message: `Query parameter '${paramName}' is missing a 'type'`,
        code: 'query_param_type_missing',
      });
      continue;
    }
    if (!DATA_TYPES.has(type)) {
      issues.warn({
        field: `${path}.type`,
        message: `Query parameter '${paramName}' has unrecognised type '${type}'`,
        code: 'unknown_data_type',
      });
    }
    if (type === TYPE_OBJECT) {
      validateProperties(def.properties, path, path, issues);
    }
    if (type === TYPE_ARRAY) {
      validateArrayItems(def.items, path, path, issues);
      validateArrayConstraints(def, path, issues);
    }
  }
}
