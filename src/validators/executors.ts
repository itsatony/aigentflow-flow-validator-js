// Executor URI checks.
//
// Until AIgentFlow v2.598.0 the Go static validator did not parse executor URLs
// at all — the live registry decided at dispatch — so this validator carried a
// deliberately loose "is it `scheme://path`" check. DC-FORGE-30 changed that:
// `FlowParser.ValidateFlow` now applies the ONE parser (`ParseExecutorURLString`,
// i.e. `URL_PATTERN_REGEX`) to every step executor, and DC-FORGE-38 extended it
// to `loop.steps[i].executor`. A URL this file accepted and AIgentFlow refuses
// at save is a false PASS — the worst direction for an offline validator — so
// the shape check is now that same regex, mirrored verbatim.
//
// Classification is unchanged:
//   - unparsable URL → error (`invalid_executor_url`): AIgentFlow refuses it too;
//   - unknown scheme → warning (`unknown_executor_scheme`): the vendored list lags
//     the registry, and the Go side never rejects on scheme. See PARITY.md #1.
//
// TEMPLATED URLs ARE SKIPPED, exactly as the Go rule skips them. The engine
// renders `step.executor` as a Go template before dispatch, so
// `flow://stored/{{ .query.child_flow_id }}` is legitimate and cannot be checked
// statically. Omitting this exception rejected eight working bundled flows when
// the Go rule was first written.

import type { Flow, LoopSubStep, StepDefinition } from '../types.js';
import {
  ATLAS_EXECUTOR,
  EXECUTOR_SCHEMES,
  EXECUTOR_URL_PATTERN,
  FUNCTION_OPERATIONS,
  REMOVED_AGENT_SURFACES,
  TEMPLATE_ACTION_OPEN,
} from '../spec/index.js';
import { goTrimSpace } from './exons.js';
import { Issues, isRecord } from './util.js';

const SCHEME_SEPARATOR = '://';

const UNKNOWN_SCHEME_BASE = (scheme: string): string =>
  `Unknown executor scheme '${scheme}'. It may be valid in a newer AIgentFlow release, or it could be a typo.`;
const DECIDE_SCHEME = 'decide';
const DECIDE_HINT =
  'Decision models run through ai://{provider}/decide (for example ai://openai/decide), not through a scheme of their own.';
const MAX_SCHEME_EDIT_DISTANCE = 2;

/** Levenshtein distance over UTF-16 code units (schemes are ASCII). */
function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j]! + 1,
        cur[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/**
 * The warning text: the base sentence, then for `decide` the pointer to
 * ai://<p>/decide, else a nearest known scheme within edit distance 2
 * (case-insensitive; the closest wins, ties to the alphabetically first).
 */
function unknownSchemeMessage(scheme: string): string {
  const lower = scheme.toLowerCase();
  const base = UNKNOWN_SCHEME_BASE(scheme);
  if (lower === DECIDE_SCHEME) return `${base} ${DECIDE_HINT}`;
  let best: string | undefined;
  let bestDist = MAX_SCHEME_EDIT_DISTANCE + 1;
  for (const known of [...EXECUTOR_SCHEMES].sort()) {
    const d = editDistance(lower, known);
    if (d < bestDist) {
      best = known;
      bestDist = d;
    }
  }
  return best === undefined ? base : `${base} Did you mean '${best}'?`;
}

function checkExecutor(executor: string, field: string, stepID: string, issues: Issues): void {
  const sepIdx = executor.indexOf(SCHEME_SEPARATOR);
  const scheme = sepIdx > 0 ? executor.slice(0, sepIdx) : '';

  // A templated URL is rendered by the engine before dispatch, so its shape
  // cannot be judged here. The scheme is still checked when the scheme itself
  // carries no template, because that half is knowable.
  const templated = executor.includes(TEMPLATE_ACTION_OPEN);

  if (!templated && !EXECUTOR_URL_PATTERN.test(executor)) {
    issues.error({
      field,
      message: `Executor '${executor}' is not a usable executor URL`,
      code: 'invalid_executor_url',
      stepId: stepID,
      suggestion:
        "Use the form 'scheme://authority/path' with a non-empty authority (e.g., 'ai://openai/chat'). " +
        'Authority and path accept letters, digits, underscore and hyphen only.',
    });
    return;
  }

  if (scheme === '' || scheme.includes(TEMPLATE_ACTION_OPEN)) return;

  if (!EXECUTOR_SCHEMES.has(scheme.toLowerCase())) {
    issues.warn({
      field,
      message: unknownSchemeMessage(scheme),
      code: 'unknown_executor_scheme',
      stepId: stepID,
    });
    return;
  }

  checkFunctionOperation(executor, field, stepID, templated, issues);
}

// The agent surfaces AIgentFlow removed. The scheme is the text before `://`
// after trimming whitespace, lower-cased; a templated executor is not judged
// (nothing can be said about what it renders to).
export function removedExecutorScheme(executor: string): string {
  if (executor.includes(TEMPLATE_ACTION_OPEN)) return '';
  const trimmed = goTrimSpace(executor);
  const at = trimmed.indexOf(SCHEME_SEPARATOR);
  return at < 0 ? '' : trimmed.slice(0, at).toLowerCase();
}

/**
 * Judges one step's executor against the removed surfaces and reports whether
 * the step is on a removed scheme. Such a step yields ONLY `executor_removed`,
 * so the caller skips the scheme-specific rules (URL shape, unknown scheme).
 * An `ai://` step whose query carries any removed parameter gets ONE finding
 * naming them all (presence alone counts: null and false included).
 */
function checkRemovedSurfaces(
  executor: string,
  query: unknown,
  field: string,
  stepID: string,
  issues: Issues,
): boolean {
  const cfg = REMOVED_AGENT_SURFACES;
  const quoted = JSON.stringify(stepID);
  const scheme = removedExecutorScheme(executor);
  if (cfg.schemes.has(scheme)) {
    issues.error({
      field,
      message: fillRemovedMessage(cfg.schemeMessageFormat, quoted, scheme),
      code: cfg.executorRemovedCode,
      stepId: stepID,
      suggestion: cfg.suggestion,
    });
    return true;
  }
  if (scheme !== cfg.paramScheme || !isRecord(query)) return false;
  const found = Object.keys(query)
    .filter((key) => cfg.aiParams.has(key))
    .sort();
  if (found.length > 0) {
    issues.error({
      field,
      message: fillRemovedMessage(cfg.paramsMessageFormat, quoted, found.join(', ')),
      code: cfg.agenticParamRemovedCode,
      stepId: stepID,
      suggestion: cfg.suggestion,
    });
  }
  return false;
}

/** Fills the spec's `%q` / `%s` placeholders in order. */
function fillRemovedMessage(format: string, ...args: string[]): string {
  let i = 0;
  return format.replace(/%[qs]/g, () => args[i++] ?? '');
}

/** The flow-level keys that belonged to a removed surface (field = the key). */
export function validateRemovedFlowKeys(flow: Flow, issues: Issues): void {
  const cfg = REMOVED_AGENT_SURFACES;
  for (const key of cfg.flowKeys) {
    if (Object.prototype.hasOwnProperty.call(flow, key)) {
      issues.error({
        field: key,
        message: fillRemovedMessage(cfg.flowKeyMessageFormat, JSON.stringify(key)),
        code: cfg.executorRemovedCode,
        suggestion: cfg.suggestion,
      });
    }
  }
}

// Agent-runtime rules. Run only for an untemplated `nexus://` URL or one written
// with its alias `atlas://` (AIgentFlow 2.835.0: one executor, two spellings, the
// same rules and codes for both; the scheme match is exact and case-sensitive).
// The URL says which Nexus operation the step performs; the query is checked
// against what that operation needs. `stepField` is the step itself, as the
// findings are about the step as a whole. An AigentChat-shaped
// `nexus://<org>/<agent>` (that executor was removed in 2.819.0) reaches these
// rules and is `atlas_operation_unknown`.
//
// The URL is split at the first slash after the scheme rather than through the
// shared executor-URL shape, so a reference the shape refuses (a dot or colon in
// a capability reference) is still judged by the atlas rules; the shape's own
// `invalid_executor_url` finding is reported separately, as before.
function checkAtlasStep(
  executor: string,
  query: unknown,
  stepField: string,
  stepID: string,
  issues: Issues,
): void {
  if (executor.includes(TEMPLATE_ACTION_OPEN)) return;
  const sep = executor.indexOf(SCHEME_SEPARATOR);
  if (sep < 0 || !ATLAS_EXECUTOR.schemes.has(executor.slice(0, sep))) return;
  const rest = executor.slice(sep + SCHEME_SEPARATOR.length);
  const slash = rest.indexOf('/');
  const provider = slash < 0 ? rest : rest.slice(0, slash);
  const resource = slash < 0 ? '' : rest.slice(slash + 1);
  const quoted = JSON.stringify(stepID);
  const report = (
    rule: { code: string; messageFormat: string; suggestion: string },
    ...args: string[]
  ): void => {
    let message = rule.messageFormat.replace('%s', () => quoted);
    for (const a of args) message = message.replace('%s', () => a);
    issues.error({
      field: stepField,
      message,
      code: rule.code,
      stepId: stepID,
      suggestion: rule.suggestion,
    });
  };
  const q: Record<string, unknown> = isRecord(query) ? query : {};
  let refusedKeys: readonly string[] = ATLAS_EXECUTOR.paramRefused.capabilityKeys;

  if (provider === ATLAS_EXECUTOR.providerCapability) {
    if (!ATLAS_EXECUTOR.capabilityRefPattern.test(resource)) {
      report(ATLAS_EXECUTOR.capabilityRefInvalid, resource);
    }
  } else if (
    provider === ATLAS_EXECUTOR.providerAgent &&
    resource === ATLAS_EXECUTOR.agentResource
  ) {
    refusedKeys = ATLAS_EXECUTOR.paramRefused.agentKeys;
    const agent = q.agent;
    if (typeof agent !== 'string' || agent.trim() === '') {
      report(ATLAS_EXECUTOR.agentMissing);
    } else if (agent.includes(TEMPLATE_ACTION_OPEN)) {
      report(ATLAS_EXECUTOR.agentNotLiteral);
    }
    const hasPrompt = atlasTextPresent(q.prompt);
    const hasTemplate = atlasTextPresent(q.prompt_template);
    if (!hasPrompt && !hasTemplate) report(ATLAS_EXECUTOR.promptMissing);
    else if (hasPrompt && hasTemplate) report(ATLAS_EXECUTOR.promptBoth);
    if (anyTemplate(q.model)) report(ATLAS_EXECUTOR.modelNotLiteral);
  } else {
    report(ATLAS_EXECUTOR.operationUnknown, executor);
    return;
  }

  // A templated capability entry is refused wherever the list appears on an
  // atlas:// step, nested values included.
  if (anyTemplate(q.capabilities)) report(ATLAS_EXECUTOR.capabilitiesNotLiteral);

  // One finding per step, listing every key the platform owns that it carries.
  const refused = refusedKeys.filter((key) => Object.prototype.hasOwnProperty.call(q, key)).sort();
  if (refused.length > 0) report(ATLAS_EXECUTOR.paramRefused, refused.join(', '));
}

/** True when a string, or any string nested in a list or mapping, holds a template action. */
function anyTemplate(v: unknown): boolean {
  if (typeof v === 'string') return v.includes(TEMPLATE_ACTION_OPEN);
  if (Array.isArray(v)) return v.some(anyTemplate);
  if (isRecord(v)) return Object.values(v).some(anyTemplate);
  return false;
}

/** A value that is set: not absent, null, or a string that is empty after trimming. */
function atlasTextPresent(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  return typeof v !== 'string' || v.trim() !== '';
}

// `unknown_function_operation`: port of `validateFunctionOperationKnown`. Runs
// only for an untemplated, parsable `function://` URL; the scheme match is exact,
// as the reference's parsed type comparison is.
function checkFunctionOperation(
  executor: string,
  field: string,
  stepID: string,
  templated: boolean,
  issues: Issues,
): void {
  if (templated) return;
  const m = EXECUTOR_URL_PATTERN.exec(executor);
  if (m === null || m[1] !== FUNCTION_OPERATIONS.scheme) return;
  const op = `${m[2]}/${m[3]}`;
  if (FUNCTION_OPERATIONS.operations.has(op)) return;
  const list = FUNCTION_OPERATIONS.sorted.join(', ');
  issues.error({
    field,
    message: FUNCTION_OPERATIONS.messageFormat
      .replace('%s', () => JSON.stringify(stepID))
      .replace('%s', () => op)
      .replace('%s', () => list),
    code: FUNCTION_OPERATIONS.code,
    stepId: stepID,
    suggestion: FUNCTION_OPERATIONS.suggestionFormat.replace('%s', () => list),
  });
}

export function validateExecutors(flow: Flow, issues: Issues): void {
  const steps = flow.steps;
  if (!isRecord(steps)) return;

  for (const [stepID, rawStep] of Object.entries(steps)) {
    if (!isRecord(rawStep)) continue;
    const step = rawStep as StepDefinition;

    // A Go `string`: `executor: 42` is the URL "42", refused as a URL.
    const executor = issues.stringOf(step, 'executor', `steps.${stepID}`);
    if (executor !== null && executor !== '') {
      if (!checkRemovedSurfaces(executor, step.query, `steps.${stepID}`, stepID, issues)) {
        checkExecutor(executor, `steps.${stepID}.executor`, stepID, issues);
      }
      checkAtlasStep(executor, step.query, `steps.${stepID}`, stepID, issues);
    }

    // Loop sub-steps each carry their own executor.
    const loop = step.loop;
    if (isRecord(loop) && Array.isArray(loop.steps)) {
      loop.steps.forEach((sub: unknown, i: number) => {
        if (!isRecord(sub)) return;
        const subStep = sub as LoopSubStep;
        const subPath = `steps.${stepID}.loop.steps[${i}]`;
        const subID = issues.stringOf(subStep, 'id', subPath) ?? String(i);
        const subExecutor = issues.stringOf(subStep, 'executor', subPath);
        if (subExecutor !== null && subExecutor !== '') {
          if (
            !checkRemovedSurfaces(subExecutor, subStep.query, subPath, `${stepID}.${subID}`, issues)
          ) {
            checkExecutor(
              subExecutor,
              `steps.${stepID}.loop.steps[${i}].executor`,
              `${stepID}.${subID}`,
              issues,
            );
          }
          checkAtlasStep(subExecutor, subStep.query, subPath, `${stepID}.${subID}`, issues);
        }
      });
    }
  }
}
