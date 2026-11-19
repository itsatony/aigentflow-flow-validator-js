// Assets (AIgentFlow 2.913.0, validation.assets.go and flow.assets.go).
//
// A flow-level `assets:` block names long step bodies kept outside the flow. Each
// asset sets exactly one source with its pin; a step string value that is exactly
// `asset://<name>` (one token, no whitespace) is replaced by that text before the
// flow runs, and only the step's query, its quality_gate rubric and a loop
// sub-step's query may hold one. Whether a remote asset exists and matches its
// sha256 is the reference server's check, not a save-door rule.

import { ASSET_GRAMMAR, CATALOG_FLOW } from '../spec/index.js';
import type { Flow } from '../types.js';
import { Issues, isRecord } from './util.js';

const WHITESPACE = /\s/u;

function format(messageFormat: string, ...args: string[]): string {
  let message = messageFormat;
  for (const a of args) message = message.replace(/%[sq]/, () => a);
  return message;
}

/** The asset name a string value references, or null when it is not a reference. */
export function assetReferenceName(v: unknown): string | null {
  if (typeof v !== 'string' || !v.startsWith(ASSET_GRAMMAR.referencePrefix)) return null;
  const name = v.slice(ASSET_GRAMMAR.referencePrefix.length);
  if (name === '' || WHITESPACE.test(name)) return null;
  return name;
}

function collect(v: unknown, into: Set<string>): void {
  if (Array.isArray(v)) {
    for (const item of v) collect(item, into);
    return;
  }
  if (isRecord(v)) {
    for (const value of Object.values(v)) collect(value, into);
    return;
  }
  const name = assetReferenceName(v);
  if (name !== null) into.add(name);
}

/** Every reference in the step outside query, quality_gate.rubric and loop sub-step queries. */
function referencesOutsideSites(step: Record<string, unknown>): Set<string> {
  const out = new Set<string>();
  for (const [key, value] of Object.entries(step)) {
    if (key === 'query') continue;
    if (key === 'quality_gate' && isRecord(value)) {
      for (const [gk, gv] of Object.entries(value)) if (gk !== 'rubric') collect(gv, out);
      continue;
    }
    if (key === 'loop' && isRecord(value)) {
      for (const [lk, lv] of Object.entries(value)) {
        if (lk === 'steps' && Array.isArray(lv)) {
          for (const sub of lv) {
            if (!isRecord(sub)) {
              collect(sub, out);
              continue;
            }
            for (const [sk, sv] of Object.entries(sub)) if (sk !== 'query') collect(sv, out);
          }
          continue;
        }
        collect(lv, out);
      }
      continue;
    }
    collect(value, out);
  }
  return out;
}

function declarationProblem(
  name: string,
  asset: unknown,
  path: string,
  issues: Issues,
): string | null {
  const p = ASSET_GRAMMAR.declarationInvalid.problems;
  if (!ASSET_GRAMMAR.namePattern.test(name)) return format(p.name, JSON.stringify(name));
  if (!isRecord(asset)) return p.noSource;
  const field = (k: string): string => issues.stringOf(asset, k, path) ?? '';
  const content = field('content');
  const trove = field('trove_key');
  const aiv = field('aiv_ref');
  const version = field('version');
  const sha256 = field('sha256');
  const sources = [content, trove, aiv].filter((s) => s !== '').length;
  if (sources === 0) return p.noSource;
  if (sources > 1) return p.manySources;
  if (content !== '' && (sha256 !== '' || version !== '')) return p.inlinePin;
  if (content === '' && !ASSET_GRAMMAR.sha256Pattern.test(sha256)) return p.sha256;
  if (trove !== '' && version !== '') return p.troveVersion;
  if (aiv !== '' && !CATALOG_FLOW.versionPattern.test(version)) return p.aivVersion;
  if (aiv !== '') {
    const parts = aiv.split('/');
    if (parts.length !== 2 || !parts.every((s) => CATALOG_FLOW.segmentPattern.test(s))) {
      return p.aivRef;
    }
  }
  return null;
}

export function validateAssets(f: Flow, issues: Issues): void {
  const declared = isRecord(f.assets) ? f.assets : {};
  const rule = ASSET_GRAMMAR.declarationInvalid;
  for (const name of Object.keys(declared).sort()) {
    const problem = declarationProblem(name, declared[name], `assets.${name}`, issues);
    if (problem !== null) {
      issues.error({
        field: `assets.${name}`,
        message: format(rule.messageFormat, JSON.stringify(name), problem),
        code: rule.code,
        suggestion: rule.suggestion,
      });
    }
  }
  const steps = f.steps;
  if (!isRecord(steps)) return;
  for (const id of Object.keys(steps).sort()) {
    const step = steps[id];
    if (!isRecord(step)) continue;
    const placement = ASSET_GRAMMAR.placementOutside;
    for (const name of [...referencesOutsideSites(step)].sort()) {
      issues.error({
        field: `steps.${id}`,
        message: format(placement.messageFormat, id, name),
        code: placement.code,
        stepId: id,
        suggestion: placement.suggestion,
      });
    }
    const all = new Set<string>();
    collect(step, all);
    const unknown = ASSET_GRAMMAR.referenceUnknown;
    for (const name of [...all].sort()) {
      if (declared[name] !== undefined && declared[name] !== null) continue;
      issues.error({
        field: `steps.${id}`,
        message: format(unknown.messageFormat, id, name),
        code: unknown.code,
        stepId: id,
        suggestion: unknown.suggestion,
      });
    }
  }
}
