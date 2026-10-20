// `reserved_input_name`: an input the flow declares in the platform's `__`
// namespace.
//
// The platform keeps that namespace for values it writes itself: the acting
// person, the credential manifest, the untrusted-input marker. A declared default
// under such a name used to be a way for a flow author to write one of them, and a
// value or default written there is never delivered at run time, so the author
// learns at save that the name cannot carry data.
//
// Both places an input is declared are read: the keys of the top-level `query:`
// mapping (reported sorted, field `query.<name>`) and the `name` of every
// `input_schema.fields[]` entry (in file order, field `input_schema.fields.<name>`).
// A schema field is addressed by NAME, not by index like this port's other
// input_schema findings, because the reference reports it that way and a host that
// merges several verdicts drops a finding only when code and field both match.
// A non-string name is skipped (`input_schema_invalid_field_name` names it).
// Findings carry no step id.

import type { Flow } from '../types.js';
import { RESERVED_INPUT_NAMES } from '../spec/index.js';
import { Issues, isRecord } from './util.js';

function formatField(format: string, name: string): string {
  return format.replace('%s', () => name);
}

export function validateReservedInputNames(flow: Flow, issues: Issues): void {
  const rule = RESERVED_INPUT_NAMES;
  const report = (name: string, fieldFormat: string): void => {
    issues.error({
      field: formatField(fieldFormat, name),
      message: rule.messageFormat.replace('%s', () => JSON.stringify(name)),
      code: rule.code,
      suggestion: rule.suggestion,
    });
  };
  const query = (flow as { query?: unknown }).query;
  if (isRecord(query)) {
    for (const name of Object.keys(query).sort()) {
      if (name.startsWith(rule.prefix)) report(name, rule.queryFieldFormat);
    }
  }
  const schema = (flow as { input_schema?: unknown }).input_schema;
  const fields = isRecord(schema) ? schema.fields : undefined;
  if (!Array.isArray(fields)) return;
  for (const f of fields) {
    if (!isRecord(f)) continue;
    if (typeof f.name === 'string' && f.name.startsWith(rule.prefix)) {
      report(f.name, rule.schemaFieldFormat);
    }
  }
}
