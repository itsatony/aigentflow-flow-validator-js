// The orchestrator's inline `.exons` document, judged where the reference's
// save door judges it: the exons half of `validateOrchestrator` (parser.go),
// the `requirements.resources` refusal (AIgentFlow v2.767.0) and the
// `orchestrator_tool_withheld` warning (v2.760.0).
//
// ⚠ This validator has NO `.exons` template engine and must not grow one: a
// second implementation of that grammar would be a second opinion about it. It
// reads the YAML FRONTMATTER only, the way the engine extracts and decodes it,
// and refuses only where the engine is certain to refuse as well. What it cannot
// see (PARITY.md, divergence #16): a document that fails to parse for any other
// reason, including a spec the engine's own validation refuses; a tag that
// cannot render (`exons_attributes`, on a step's `query.exons` and on the
// orchestrator); and a frontmatter containing a tag, which the engine EXECUTES
// before decoding, so it is not read at all. The direction is always looser,
// never stricter.

import { isMap, isScalar, isSeq, parseAllDocuments } from 'yaml';
import type { Flow } from '../types.js';
import { EXONS, ORCHESTRATOR_TOOL_ALLOW } from '../spec/index.js';
import { Issues, isArray, isRecord, isString } from './util.js';

const CODE_PARSE_FAILED = 'orchestrator_exons_parse_failed';
const CODE_NO_PROVIDER = 'orchestrator_exons_no_provider';
const CODE_RESOURCES = 'exons_resources_unhonoured';
const CODE_TOOL_WITHHELD = 'orchestrator_tool_withheld';

/** The engine's tag opener. A frontmatter containing it is executed before it is decoded. */
const EXONS_OPEN_DELIM = '{~';
/** The retired JSON config-block opener; the engine refuses a document starting with it. */
const EXONS_LEGACY_CONFIG_OPEN = '{~exons.config~}';
const UTF8_BOM = '﻿';
const MAX_ALIAS_COUNT = 100;

/** One `requirements.resources` entry. */
export interface ExonsResource {
  ref: string;
  kind: string;
  scope: string;
}

/**
 * What the save-door rules know about one `.exons` document, from its
 * frontmatter alone. Mirrors the Go port's `ExonsReport` minus the fields only
 * an engine can fill.
 */
export interface ExonsFrontmatterReport {
  /**
   * Why the engine's parse is CERTAIN to refuse the document (an unclosed
   * frontmatter, the retired config block), or null.
   */
  parseError: string | null;
  /**
   * true when the fields below are known. false when the frontmatter cannot be
   * read the way the engine would (it contains a tag, or its YAML does not
   * decode into the fields the rules read); then no rule reads them.
   */
  specRead: boolean;
  /** The document declares a frontmatter spec. */
  hasSpec: boolean;
  /** `execution.provider`, '' when absent. */
  provider: string;
  /** An absent `tools.allow` (no narrowing) is not an empty one. */
  toolsAllowDeclared: boolean;
  toolsAllow: string[];
  resources: ExonsResource[];
}

const UNREAD: ExonsFrontmatterReport = {
  parseError: null,
  specRead: false,
  hasSpec: false,
  provider: '',
  toolsAllowDeclared: false,
  toolsAllow: [],
  resources: [],
};

// Go's strings.TrimSpace (unicode.IsSpace), which differs from String.trim():
// it trims U+0085 and does NOT trim U+FEFF.
const GO_SPACE =
  '\\t\\n\\v\\f\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
const GO_TRIM_SPACE = new RegExp(`^[${GO_SPACE}]+|[${GO_SPACE}]+$`, 'g');

function goTrimSpace(s: string): string {
  return s.replace(GO_TRIM_SPACE, '');
}

interface Frontmatter {
  frontmatter: string;
  hasFrontmatter: boolean;
  parseError: string | null;
}

/**
 * The engine's frontmatter extraction: after an optional UTF-8 BOM and leading
 * spaces or tabs (not newlines), the document must start with the delimiter
 * and a line break (LF or CRLF); the frontmatter ends at the next line that
 * starts with the delimiter followed by a line break (any CR counts) or the end
 * of the input, and is trimmed. A document without the opening delimiter has no
 * frontmatter; one whose frontmatter never closes, or that starts with the
 * retired config block, is refused.
 */
export function extractExonsFrontmatter(source: string): Frontmatter {
  const delim = EXONS.frontmatterDelimiter;
  let start = source.startsWith(UTF8_BOM) ? source.slice(UTF8_BOM.length) : source;
  start = start.replace(/^[ \t]+/, '');
  if (start.startsWith(EXONS_LEGACY_CONFIG_OPEN)) {
    return {
      frontmatter: '',
      hasFrontmatter: false,
      parseError: 'legacy JSON config block detected; use YAML frontmatter',
    };
  }
  if (!start.startsWith(delim)) return { frontmatter: '', hasFrontmatter: false, parseError: null };
  let rest = start.slice(delim.length);
  if (rest.startsWith('\n')) rest = rest.slice(1);
  else if (rest.startsWith('\r\n')) rest = rest.slice(2);
  else return { frontmatter: '', hasFrontmatter: false, parseError: null };

  let pos = 0;
  while (pos <= rest.length) {
    const line = rest.slice(pos);
    if (line.startsWith(delim)) {
      const after = line.slice(delim.length);
      if (after === '' || after[0] === '\n' || after[0] === '\r') {
        return {
          frontmatter: goTrimSpace(rest.slice(0, pos)),
          hasFrontmatter: true,
          parseError: null,
        };
      }
    }
    const nl = line.indexOf('\n');
    if (nl < 0) break;
    pos += nl + 1;
  }
  return {
    frontmatter: '',
    hasFrontmatter: true,
    parseError: 'YAML frontmatter not properly closed',
  };
}

/**
 * Every number or boolean scalar becomes its SOURCE text, before conversion.
 * The fields the rules read are all Go `string`s (or lists of them), which
 * yaml.v3 fills from any scalar by its text; a scalar where a mapping or list
 * belongs is a decode error either way.
 */
function retagScalars(node: unknown): void {
  if (isMap(node)) {
    for (const pair of node.items) {
      retagScalars(pair.key);
      retagScalars(pair.value);
    }
  } else if (isSeq(node)) {
    for (const item of node.items) retagScalars(item);
  } else if (
    isScalar(node) &&
    (typeof node.value === 'number' || typeof node.value === 'boolean') &&
    typeof node.source === 'string'
  ) {
    node.value = node.source;
  }
}

/** A declared field of the wrong shape: yaml.v3 fails the whole decode. */
class DecodeError extends Error {}

/** yaml.v3 into a Go `string`: null is '', a scalar its text, anything else a decode error. */
function goString(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (isString(v)) return v;
  throw new DecodeError('not a string');
}

/**
 * yaml.v3 into a `[]string`: null is nil (absent). A null ELEMENT is dropped,
 * not decoded to '': yaml.v3 appends an element only when the decode set it,
 * and a null sets nothing in a string or a struct.
 */
function goStringList(v: unknown): string[] | null {
  if (v === null || v === undefined) return null;
  if (!isArray(v)) throw new DecodeError('not a list');
  return v.filter((item) => item !== null).map(goString);
}

/** yaml.v3 into a struct pointer: null is nil. */
function goStruct(v: unknown): Record<string, unknown> | null {
  if (v === null || v === undefined) return null;
  if (!isRecord(v)) throw new DecodeError('not a mapping');
  return v;
}

/**
 * The decode of the frontmatter into the fields the rules read, as the
 * engine's non-strict yaml.v3 decode does it: an undeclared key is ignored, a
 * declared one of the wrong shape fails the whole decode. null when it fails.
 */
function decodeSpecFields(
  frontmatter: string,
): Omit<ExonsFrontmatterReport, 'parseError' | 'specRead' | 'hasSpec'> | null {
  let value: unknown;
  try {
    // yaml.v3's Unmarshal decodes the first document only.
    const docs = parseAllDocuments(frontmatter, { merge: true });
    const doc = Array.isArray(docs) ? docs[0] : undefined;
    if (doc === undefined) {
      value = null;
    } else {
      if (doc.errors.length > 0) return null;
      retagScalars(doc.contents);
      value = doc.toJS({ maxAliasCount: MAX_ALIAS_COUNT });
    }
  } catch {
    return null;
  }
  try {
    const root = goStruct(value) ?? {};
    const execution = goStruct(root.execution);
    const tools = goStruct(root.tools);
    const requirements = goStruct(root.requirements);
    const allow = tools === null ? null : goStringList(tools.allow);
    let resources: ExonsResource[] = [];
    if (requirements !== null) {
      const raw = requirements.resources;
      if (raw !== null && raw !== undefined) {
        if (!isArray(raw)) throw new DecodeError('not a list');
        // A null entry is dropped, as in goStringList.
        resources = raw
          .filter((entry) => entry !== null)
          .map((entry) => {
            const r = goStruct(entry) ?? {};
            return { ref: goString(r.ref), kind: goString(r.kind), scope: goString(r.scope) };
          });
      }
    }
    return {
      provider: execution === null ? '' : goString(execution.provider),
      toolsAllowDeclared: allow !== null,
      toolsAllow: allow ?? [],
      resources,
    };
  } catch (e) {
    if (e instanceof DecodeError) return null;
    throw e;
  }
}

/** Read one `.exons` document's frontmatter the way the engine would. */
export function inspectExonsFrontmatter(source: string): ExonsFrontmatterReport {
  const fm = extractExonsFrontmatter(source);
  if (fm.parseError !== null) return { ...UNREAD, parseError: fm.parseError };
  // No spec: the engine's parse yields a nil spec.
  if (!fm.hasFrontmatter || fm.frontmatter === '') return { ...UNREAD, specRead: true };
  if (fm.frontmatter.includes(EXONS_OPEN_DELIM)) return { ...UNREAD };
  const fields = decodeSpecFields(fm.frontmatter);
  if (fields === null) return { ...UNREAD };
  return { parseError: null, specRead: true, hasSpec: true, ...fields };
}

/**
 * Refusals, in the reference's order: the document does not parse (here: only
 * an unclosed frontmatter or the retired config block); no frontmatter spec,
 * which the reference reports as a parse failure; no `execution.provider`; any
 * `requirements.resources` entry (AIgentFlow can honour no declared resource
 * today, so every one is refused rather than run without the narrowing it asks
 * for). Then the `orchestrator_tool_withheld` warning. The document's presence
 * is `orchestrator_exons_required`, judged in orchestratorCampaign.ts.
 */
export function validateOrchestratorExons(flow: Flow, issues: Issues): void {
  const orch: unknown = flow.orchestrator;
  if (!isRecord(orch)) return;
  const source = issues.stringOf(orch, 'exons', 'orchestrator');
  if (source === null || source === '') return;
  const field = 'orchestrator.exons';
  const report = inspectExonsFrontmatter(source);

  if (report.parseError !== null) {
    issues.error({
      field,
      code: CODE_PARSE_FAILED,
      message: `orchestrator: failed to parse exons spec: ${report.parseError}`,
    });
    return;
  }
  if (!report.specRead) return;
  if (!report.hasSpec) {
    issues.error({
      field,
      code: CODE_PARSE_FAILED,
      message: 'orchestrator: failed to parse exons spec: the document has no frontmatter spec',
      suggestion: 'Start the document with a --- frontmatter block that sets execution.provider',
    });
    return;
  }
  if (report.provider === '') {
    issues.error({
      field,
      code: CODE_NO_PROVIDER,
      message: 'orchestrator: exons spec must have execution.provider set',
    });
  }
  if (report.resources.length > 0) {
    const refs = report.resources.map((r) => `${JSON.stringify(r.ref)} (kind ${r.kind})`);
    issues.error({
      field,
      code: CODE_RESOURCES,
      message:
        "the orchestrator's exons spec declares requirements.resources that AIgentFlow cannot " +
        'honour, so it is refused rather than run without the narrowing it asks for: ' +
        refs.join('; '),
      suggestion:
        'Remove requirements.resources, and narrow the agent with tools.mcp_servers and tools.allow',
    });
  }
  warnOrchestratorToolWithheld(flow, orch, report, issues);
}

/**
 * An orchestrator tool is offered only if it passes BOTH `orchestrator.tools`
 * (empty = every tool) AND the definition's `tools.allow` (absent = no
 * narrowing). Two lists that each read as complete can disagree, and the
 * disagreement is silent at run time. Reported: a tool named in
 * `orchestrator.tools` that `tools.allow` omits; with `orchestrator.tools`
 * empty, a `tools.allow` without `aif_ask_human` (human intervention off), and
 * one that names no campaign tool when the flow declares a campaign.
 *
 * A WARNING, never an error: an unattended orchestrator is a legitimate design.
 */
function warnOrchestratorToolWithheld(
  flow: Flow,
  orch: Record<string, unknown>,
  report: ExonsFrontmatterReport,
  issues: Issues,
): void {
  if (!report.toolsAllowDeclared) return;
  const cfg = ORCHESTRATOR_TOOL_ALLOW;
  const exempt = new Set<string>(cfg.lifecycleTools);
  // Only a YAML boolean sets it; absent (or anything else) is the default, on.
  const signals =
    typeof orch.enable_signals === 'boolean' ? orch.enable_signals : cfg.enableSignalsDefault;
  if (signals) for (const t of cfg.signalTools) exempt.add(t);
  const allow = new Set(report.toolsAllow);
  const withheld = (name: string): boolean => !allow.has(name) && !exempt.has(name);
  const warn = (message: string): void =>
    issues.warn({ field: cfg.warningField, code: CODE_TOOL_WITHHELD, message });

  const named: string[] = [];
  if (isArray(orch.tools)) {
    orch.tools.forEach((raw: unknown, i: number) => {
      const name = issues.stringAt(raw, `orchestrator.tools[${i}]`);
      if (name !== null) named.push(name);
    });
  }
  if (named.length > 0) {
    for (const name of named) {
      if (!withheld(name)) continue;
      warn(
        `orchestrator tool '${name}' is named in orchestrator.tools but the orchestrator's exons ` +
          "definition's tools.allow does not name it, so it is never offered: a tool must pass " +
          `both lists. Add '${name}' to tools.allow, or remove it from orchestrator.tools.`,
      );
    }
    return;
  }
  if (withheld(cfg.askHumanTool)) {
    warn(
      `the orchestrator's exons definition has a tools.allow list that does not name ` +
        `${cfg.askHumanTool}, so this orchestrator can never ask a person a question: human ` +
        `intervention is off. Add ${cfg.askHumanTool} to tools.allow if a human should be ` +
        'reachable, or ignore this if the orchestrator is meant to run unattended.',
    );
  }
  // A null `campaign:` is no campaign.
  if (isRecord(flow.campaign) && !cfg.campaignTools.some((name) => !withheld(name))) {
    warn(
      "this flow declares a campaign, but the orchestrator's exons definition has a tools.allow " +
        `list that names none of the campaign tools (${cfg.campaignTools.join(', ')}), so no ` +
        'child mission can be spawned or tracked. Add the campaign tools the orchestrator needs ' +
        'to tools.allow.',
    );
  }
}
