// YAML → object parsing with structured, positioned errors.
//
// Uses the `yaml` package (pure JS, browser-safe). Duplicate keys and syntax
// errors are surfaced as ValidationIssues with line/column when available.
// Alias expansion is capped to guard against "billion laughs" style payloads.

import { isMap, isScalar, isSeq, parseDocument, type YAMLError, type YAMLWarning } from 'yaml';
import type { Flow, ValidationIssue } from './types.js';

const MAX_ALIAS_COUNT = 100;

/** Result of parsing flow YAML. */
export interface ParseOutput {
  /** The parsed flow object, present only when there are no parse errors. */
  flow?: Flow;
  /** Fatal YAML syntax / structure errors. Non-empty means `flow` is absent. */
  parseErrors: ValidationIssue[];
  /** Non-fatal YAML warnings (e.g. deprecated tags). */
  parseWarnings: ValidationIssue[];
  /**
   * The SOURCE spelling of every number and boolean scalar, keyed by field path
   * (`mock_scenarios.s.fetch.delay`). The reference decodes a scalar into a Go
   * `string` field as its source text, so `delay: 0.0` arrives there as "0.0"
   * (not a Go duration) while the parsed value here is the number 0. Present
   * whenever `flow` is.
   */
  scalarSources?: ReadonlyMap<string, string>;
}

/**
 * Record the source text of each plain number/boolean scalar under the field
 * path the validators use. Aliases are not followed: a value reached through
 * one keeps its parsed rendering, which differs only for spellings such as
 * `0.0` (see PARITY.md).
 */
function collectScalarSources(node: unknown, path: string, out: Map<string, string>): void {
  if (isMap(node)) {
    for (const pair of node.items) {
      const key = isScalar(pair.key) ? String(pair.key.value) : null;
      if (key === null) continue;
      collectScalarSources(pair.value, path === '' ? key : `${path}.${key}`, out);
    }
  } else if (isSeq(node)) {
    node.items.forEach((item, i) => collectScalarSources(item, `${path}[${i}]`, out));
  } else if (isScalar(node)) {
    const v = node.value;
    if ((typeof v === 'number' || typeof v === 'boolean') && typeof node.source === 'string') {
      out.set(path, node.source);
    }
  }
}

function issueFromYamlError(
  err: YAMLError | YAMLWarning,
  severity: 'error' | 'warning',
): ValidationIssue {
  const issue: ValidationIssue = {
    field: '',
    message: err.message,
    code: err.name === 'YAMLParseError' ? 'yaml_syntax_error' : 'yaml_warning',
    severity,
  };
  const pos = err.linePos?.[0];
  if (pos) {
    issue.line = pos.line;
    issue.column = pos.col;
  }
  // The `yaml` package uses specific codes (e.g. DUPLICATE_KEY); preserve them
  // for callers that key off `code`.
  if (err.code) {
    issue.code = err.code === 'DUPLICATE_KEY' ? 'duplicate_key' : issue.code;
  }
  return issue;
}

/**
 * Parse flow YAML into a {@link Flow} object plus structured parse diagnostics.
 * Never throws — malformed input is reported via `parseErrors`.
 */
export function parseFlow(yamlText: string): ParseOutput {
  const parseErrors: ValidationIssue[] = [];
  const parseWarnings: ValidationIssue[] = [];

  if (typeof yamlText !== 'string' || yamlText.trim() === '') {
    parseErrors.push({
      field: '',
      message: 'Flow YAML is empty',
      code: 'empty_document',
      severity: 'error',
    });
    return { parseErrors, parseWarnings };
  }

  let doc;
  try {
    // `merge: true`: the reference's yaml.v3 honours `<<: *anchor` merge keys,
    // and without it `<<` survives as a literal key, which the unknown-key rule
    // would refuse on a flow the reference saves.
    doc = parseDocument(yamlText, { prettyErrors: true, uniqueKeys: true, merge: true });
  } catch (e) {
    parseErrors.push({
      field: '',
      message: `YAML parse error: ${e instanceof Error ? e.message : String(e)}`,
      code: 'yaml_syntax_error',
      severity: 'error',
    });
    return { parseErrors, parseWarnings };
  }

  for (const err of doc.errors) {
    parseErrors.push(issueFromYamlError(err, 'error'));
  }
  for (const warn of doc.warnings) {
    parseWarnings.push(issueFromYamlError(warn, 'warning'));
  }
  if (parseErrors.length > 0) {
    return { parseErrors, parseWarnings };
  }

  let value: unknown;
  try {
    value = doc.toJS({ maxAliasCount: MAX_ALIAS_COUNT });
  } catch (e) {
    parseErrors.push({
      field: '',
      message: `YAML resolution error: ${e instanceof Error ? e.message : String(e)}`,
      code: 'yaml_syntax_error',
      severity: 'error',
    });
    return { parseErrors, parseWarnings };
  }

  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    parseErrors.push({
      field: '',
      message: 'Flow must be a YAML mapping at the top level',
      code: 'invalid_flow_root',
      severity: 'error',
    });
    return { parseErrors, parseWarnings };
  }

  const scalarSources = new Map<string, string>();
  collectScalarSources(doc.contents, '', scalarSources);
  return { flow: value as Flow, parseErrors, parseWarnings, scalarSources };
}
