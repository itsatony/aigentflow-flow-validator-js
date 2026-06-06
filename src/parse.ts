// YAML → object parsing with structured, positioned errors.
//
// Uses the `yaml` package (pure JS, browser-safe). Duplicate keys and syntax
// errors are surfaced as ValidationIssues with line/column when available.
// Alias expansion is capped to guard against "billion laughs" style payloads.

import { parseDocument, type YAMLError, type YAMLWarning } from 'yaml';
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
    doc = parseDocument(yamlText, { prettyErrors: true, uniqueKeys: true });
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

  return { flow: value as Flow, parseErrors, parseWarnings };
}
