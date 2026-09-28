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
 * The text a Go `string` receives for a scalar node: its source spelling. The
 * `yaml` package keeps it on `Scalar.source` (the scalar's text after quote and
 * escape processing), while `Scalar.value` is the resolved number or boolean —
 * `1.0` → 1, `0x1F` → 31, `True` → true, `-0` → -0. null when the node is not a
 * scalar, or is a YAML null (a null is absent, not text).
 */
function scalarSourceText(node: unknown): string | null {
  if (!isScalar(node) || node.value === null) return null;
  if (typeof node.source === 'string') return node.source;
  return typeof node.value === 'string' ? node.value : null;
}

/**
 * Give every number or boolean mapping KEY its source text, before the
 * document is converted. That is what the reference stores: its step table is
 * a `map[string]*StepDefinition`, and yaml.v3 fills a Go `string` from any
 * scalar by its text, so `1e3:` is the step "1e3", `0x1F:` is "0x1F", `True:`
 * is "True". Converting the resolved key instead gives "1000", "31", "true",
 * and a reference written `next: { default: 1e3 }` no longer matches its own
 * step. Null keys, merge keys (`<<`, a string) and complex keys are left alone.
 */
function retagScalarKeys(node: unknown): void {
  if (isMap(node)) {
    for (const pair of node.items) {
      const key = pair.key;
      if (
        isScalar(key) &&
        (typeof key.value === 'number' || typeof key.value === 'boolean') &&
        typeof key.source === 'string'
      ) {
        key.value = key.source;
      }
      retagScalarKeys(key);
      retagScalarKeys(pair.value);
    }
  } else if (isSeq(node)) {
    for (const item of node.items) retagScalarKeys(item);
  }
}

/**
 * Duplicate-key identity, as yaml.v3 decides it: two scalar keys collide when
 * their TEXT is equal, not their resolved value — `1:` and `1.0:` are two
 * steps there ("1" and "1.0"), and `"1":` and `1:` are one. The `yaml`
 * package's default compares resolved values, which would refuse the first.
 */
function sameKeyText(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!isScalar(a) || !isScalar(b)) return false;
  const ta = scalarSourceText(a);
  const tb = scalarSourceText(b);
  if (ta === null || tb === null) return a.value === b.value;
  return ta === tb;
}

/**
 * Record the source text of each plain number/boolean scalar under the field
 * path the validators use. Runs after {@link retagScalarKeys}, so a path
 * segment is a key's source text too. Aliases are not followed: a value
 * reached through one keeps its parsed rendering, which differs only for
 * spellings such as `0.0` (see PARITY.md).
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
    doc = parseDocument(yamlText, { prettyErrors: true, uniqueKeys: sameKeyText, merge: true });
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

  retagScalarKeys(doc.contents);
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
