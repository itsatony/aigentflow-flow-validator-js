// `credential_endpoint_unpaired` (WARNING): a step names an endpoint its
// credential will never be sent to.
//
// Port of the reference's `validateCredentialEndpointPairing` (AIgentFlow
// DC-FORGE-231) and `validateFamilyCredentialEndpointPairing` (DC-FORGE-233),
// together with the Go port (go-aigentflow-validator v0.6.2).
//
// AIgentFlow sends a credential the SERVER supplied (an org's or the
// platform's stored key, or a value of one of the deployment's environment
// variables) only to the endpoint that came with it: the default, the stored
// credential's own base URL, or a deployment-configured one. An endpoint the
// flow names is honoured only with a credential the flow supplies. That
// run-time refusal is the control; this is the save-time warning about the
// shapes that are statically certain to meet it. A warning, never an error: a
// run may still bring its own key, and a warning never changes the verdict.
//
// Two arms, over the same steps (a top-level step and a loop sub-step):
//
//   - ai:// — a step's `<provider>_base_url` with no key of the flow's own
//     (the step query's `api_key` / `<provider>_api_key`, or a literal
//     `executor_config.<provider>.api_key`), and a literal
//     `executor_config.<provider>.base_url` for an AI provider with no literal
//     key beside it, unless at least one step uses the provider and every such
//     step brings its own key. ollama and vllm are exempt.
//   - the families in the spec's table — a secret that is `${NAME}` for one of
//     the family's server variables (on a family whose plugin expands
//     references) beside an endpoint that is certainly the author's: not
//     templated, not a reference, not the family's default origin. A family
//     with an implicit service credential is not judged; nexus:// and its
//     alias aigentchat:// get the ai:// shape.
//
// Values are read as the reference reads them: a step `query:` and an `extra:`
// block are Go `any` there, so only a YAML string counts; `api_key` and
// `base_url` under `executor_config.<key>` are Go `string` fields, read by
// source text. Two JS-only approximations, both looser (PARITY.md): an
// endpoint shaped like a YAML timestamp is not read as a string (yaml.v3
// decodes a PLAIN one into `time.Time`), and a `!!binary` value is not one.

import type { Flow } from '../types.js';
import {
  CREDENTIAL_ENDPOINT_PAIRING as CFG,
  TEMPLATE_ACTION_OPEN,
  EXECUTOR_CONFIG_ENV_SCOPES,
} from '../spec/index.js';
import type { CredentialEndpointFamily } from '../spec/index.js';
import { envReferenceName } from './executorConfigEnv.js';
import { goEndpointOrigin } from './goUrl.js';
import { loopSubStepsOfStep } from './processingOperations.js';
import { Issues, isRecord } from './util.js';

const CODE = 'credential_endpoint_unpaired';
const KEY_EXECUTOR_CONFIG = 'executor_config';
const KEY_EXECUTOR = 'executor';
const KEY_QUERY = 'query';
const KEY_ID = 'id';

type Rec = Record<string, unknown>;

/**
 * A string yaml.v3 may have decoded into `time.Time` from a plain scalar
 * (its `parseTimestamp` formats, over-approximated: no range checks). Only
 * consulted where reading a value as a string can ADD a warning.
 */
const YAML_TIMESTAMP_LIKE =
  /^\d{4}-\d{1,2}-\d{1,2}(?:[Tt]\d{1,2}:\d{1,2}:\d{1,2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:\d{2})| \d{1,2}:\d{1,2}:\d{1,2}(?:[.,]\d+)?)?$/;

/** An own property of a plain object (never one of Object.prototype's). */
function own(m: unknown, key: string): unknown {
  if (!isRecord(m) || !Object.prototype.hasOwnProperty.call(m, key)) return undefined;
  return m[key];
}

/** Go's `fmt.Sprintf` for the `%s`-only field formats in the spec. */
function formatField(format: string, ...args: string[]): string {
  let i = 0;
  return format.replace(/%s/g, () => args[i++] ?? '');
}

/** The reference's `query[key].(string)`, non-empty. */
function nonEmptyString(m: unknown, key: string): string | null {
  const v = own(m, key);
  return typeof v === 'string' && v !== '' ? v : null;
}

/** {@link nonEmptyString} for an ENDPOINT: a timestamp-shaped value is not a string there. */
function nonEmptyEndpoint(m: unknown, key: string): string | null {
  const v = nonEmptyString(m, key);
  return v === null || YAML_TIMESTAMP_LIKE.test(v) ? null : v;
}

interface CredStep {
  executor: string;
  query: unknown;
  field: (key: string) => string;
}

function credentialEndpointSteps(flow: Flow, issues: Issues): CredStep[] {
  const steps = flow.steps;
  if (!isRecord(steps)) return [];
  const out: CredStep[] = [];
  for (const stepId of Object.keys(steps).sort()) {
    const step = steps[stepId];
    if (!isRecord(step)) continue;
    out.push({
      executor: issues.stringOf(step, KEY_EXECUTOR, `steps.${stepId}`) ?? '',
      query: own(step, KEY_QUERY),
      field: (key) => formatField(CFG.stepFieldFormat, stepId, key),
    });
    for (const sub of loopSubStepsOfStep(stepId, step)) {
      const subId = issues.stringOf(sub.raw, KEY_ID, sub.basePath) ?? '';
      out.push({
        executor: issues.stringOf(sub.raw, KEY_EXECUTOR, sub.basePath) ?? '',
        query: own(sub.raw, KEY_QUERY),
        field: (key) => formatField(CFG.loopStepFieldFormat, stepId, subId, key),
      });
    }
  }
  return out;
}

function configInstance(flow: Flow, key: string): Rec | null {
  const inst = own(own(flow, KEY_EXECUTOR_CONFIG), key);
  return isRecord(inst) ? inst : null;
}

/** A Go-`string` field of an executor_config instance, by source text; "" when absent or null. */
function configStringField(inst: Rec, configKey: string, field: string, issues: Issues): string {
  return issues.stringOf(inst, field, `${KEY_EXECUTOR_CONFIG}.${configKey}`) ?? '';
}

export function validateCredentialEndpointPairing(flow: Flow, issues: Issues): void {
  const steps = credentialEndpointSteps(flow, issues);
  validateAI(flow, steps, issues);
  validateFamilies(flow, steps, issues);
}

// --- ai:// -----------------------------------------------------------------

function aiStepProvider(executor: string): string {
  const prefix = CFG.ai.protocol + CFG.protocolSeparator;
  if (!executor.startsWith(prefix)) return '';
  const rest = executor.slice(prefix.length);
  const slash = rest.indexOf('/');
  return slash < 0 ? rest : rest.slice(0, slash);
}

function aiQueryHasOwnKey(query: unknown, provider: string): boolean {
  return [CFG.ai.genericKeyParam, provider + CFG.ai.providerKeyParamSuffix].some(
    (key) => nonEmptyString(query, key) !== null,
  );
}

function aiConfigHasOwnKey(flow: Flow, provider: string, issues: Issues): boolean {
  const inst = configInstance(flow, provider);
  if (inst === null) return false;
  const key = configStringField(inst, provider, CFG.executorConfigApiKeyField, issues);
  return key !== '' && envReferenceName(key) === null;
}

function validateAI(flow: Flow, steps: CredStep[], issues: Issues): void {
  const keyless = new Set(CFG.ai.keylessProviders);
  const stepsUsing = new Map<string, number>();
  const stepsWithoutOwnKey = new Map<string, number>();
  for (const step of steps) {
    const provider = aiStepProvider(step.executor);
    if (provider === '' || keyless.has(provider)) continue;
    stepsUsing.set(provider, (stepsUsing.get(provider) ?? 0) + 1);
    const queryOwn = aiQueryHasOwnKey(step.query, provider);
    if (!queryOwn) stepsWithoutOwnKey.set(provider, (stepsWithoutOwnKey.get(provider) ?? 0) + 1);
    const urlKey = provider + CFG.ai.providerBaseUrlParamSuffix;
    if (
      nonEmptyEndpoint(step.query, urlKey) !== null &&
      !queryOwn &&
      !aiConfigHasOwnKey(flow, provider, issues)
    ) {
      warnStoredShape(issues, step.field(urlKey), provider);
    }
  }

  const config = own(flow, KEY_EXECUTOR_CONFIG);
  if (!isRecord(config)) return;
  const providers = new Set(CFG.ai.executorConfigProviders);
  for (const provider of Object.keys(config).sort()) {
    const inst = own(config, provider);
    if (!isRecord(inst) || !providers.has(provider) || keyless.has(provider)) continue;
    const baseUrl = configStringField(inst, provider, CFG.executorConfigBaseUrlField, issues);
    if (baseUrl === '') continue;
    if (envReferenceName(baseUrl) !== null) continue; // the deployment's endpoint
    if (aiConfigHasOwnKey(flow, provider, issues)) continue;
    if ((stepsUsing.get(provider) ?? 0) > 0 && (stepsWithoutOwnKey.get(provider) ?? 0) === 0) {
      continue; // every step brings its own key
    }
    warnStoredShape(issues, formatField(CFG.executorConfigBaseUrlFieldFormat, provider), provider);
  }
}

function warnStoredShape(issues: Issues, field: string, provider: string): void {
  issues.warn({
    field,
    code: CODE,
    message:
      `${field} names an endpoint for "${provider}" but the flow supplies no ${provider} key of its own. ` +
      `At run time the org's (or the platform's) stored ${provider} credential is never sent to a host ` +
      'the flow chooses, so this step will be refused unless the run supplies its own key.',
    suggestion:
      "To use a custom endpoint with the org's credential, store the base_url on the credential; " +
      "to use the provider's default endpoint, remove this field",
  });
}

// --- the executor families -------------------------------------------------

function familyOf(executor: string): { key: string; family: CredentialEndpointFamily } | null {
  const sep = executor.indexOf(CFG.protocolSeparator);
  if (sep <= 0) return null;
  let protocol = executor.slice(0, sep);
  const rest = executor.slice(sep + CFG.protocolSeparator.length);
  const slash = rest.indexOf('/');
  const driver = slash < 0 ? rest : rest.slice(0, slash);
  const alias = own(CFG.protocolAliases, protocol);
  if (typeof alias === 'string') protocol = alias;
  const candidates =
    driver === '' ? [protocol] : [protocol + CFG.familyKeySeparator + driver, protocol];
  for (const key of candidates) {
    const family = own(CFG.families, key);
    if (family !== undefined) return { key, family: family as CredentialEndpointFamily };
  }
  return null;
}

function serverEnvRef(family: CredentialEndpointFamily, value: string): string | null {
  const name = envReferenceName(value);
  if (name === null || !family.expandsServerEnvReferences || !family.serverEnv.includes(name)) {
    return null;
  }
  return name;
}

function listHas(list: readonly string[], s: string): boolean {
  return s !== '' && list.includes(s);
}

interface FamilySecret {
  envName: string | null;
  field: string;
}

/** The step's credential: the step query first, then each executor_config block. */
function familySecret(
  flow: Flow,
  family: CredentialEndpointFamily,
  step: CredStep,
  issues: Issues,
): FamilySecret | null {
  for (const key of family.secretParams) {
    const v = nonEmptyString(step.query, key);
    if (v !== null) return { envName: serverEnvRef(family, v), field: step.field(key) };
  }
  for (const configKey of family.configKeys) {
    const inst = configInstance(flow, configKey);
    if (inst === null) continue;
    const apiKey = configStringField(inst, configKey, CFG.executorConfigApiKeyField, issues);
    if (apiKey !== '' && listHas(family.secretParams, family.configApiKeyParam)) {
      return {
        envName: serverEnvRef(family, apiKey),
        field: formatField(
          CFG.executorConfigKeyFieldFormat,
          configKey,
          CFG.executorConfigApiKeyField,
        ),
      };
    }
    const extra = own(inst, EXECUTOR_CONFIG_ENV_SCOPES.extraKey);
    for (const key of family.secretParams) {
      const v = nonEmptyString(extra, key);
      if (v !== null) {
        return {
          envName: serverEnvRef(family, v),
          field: formatField(CFG.executorConfigExtraFieldFormat, configKey, key),
        };
      }
    }
  }
  return null;
}

function isAuthorLiteral(family: CredentialEndpointFamily, v: string): boolean {
  if (v === '' || v.includes(TEMPLATE_ACTION_OPEN)) return false;
  if (envReferenceName(v) !== null) return false;
  const origin = goEndpointOrigin(v, CFG.defaultPorts, CFG.protocolSeparator);
  return !family.defaultEndpoints.some(
    (d) => goEndpointOrigin(d, CFG.defaultPorts, CFG.protocolSeparator) === origin,
  );
}

/** The field of the endpoint the step will use when it is certainly the author's, or null. */
function familyAuthorEndpoint(
  flow: Flow,
  family: CredentialEndpointFamily,
  step: CredStep,
  issues: Issues,
): string | null {
  const decide = (v: string, field: string): string | null =>
    isAuthorLiteral(family, v) ? field : null;
  for (const key of family.endpointParams) {
    const v = nonEmptyEndpoint(step.query, key);
    if (v !== null) return decide(v, step.field(key));
  }
  for (const configKey of family.configKeys) {
    const inst = configInstance(flow, configKey);
    if (inst === null) continue;
    const baseUrl = configStringField(inst, configKey, CFG.executorConfigBaseUrlField, issues);
    if (baseUrl !== '' && listHas(family.endpointParams, family.configBaseUrlParam)) {
      return decide(baseUrl, formatField(CFG.executorConfigBaseUrlFieldFormat, configKey));
    }
    const extra = own(inst, EXECUTOR_CONFIG_ENV_SCOPES.extraKey);
    for (const key of family.endpointParams) {
      const v = nonEmptyEndpoint(extra, key);
      if (v !== null)
        return decide(v, formatField(CFG.executorConfigExtraFieldFormat, configKey, key));
    }
  }
  return null;
}

function storedShapeHasOwnKey(family: CredentialEndpointFamily, query: unknown): boolean {
  const shape = family.storedKeyShape;
  if (shape === undefined) return false;
  if (shape.ownKeyParams.some((key) => nonEmptyString(query, key) !== null)) return true;
  return isRecord(own(query, shape.ownCredentialsMapParam));
}

function validateFamilies(flow: Flow, steps: CredStep[], issues: Issues): void {
  for (const step of steps) {
    const found = familyOf(step.executor);
    if (found === null || found.family.implicitServerCredential) continue;
    const { key: familyKey, family } = found;
    if (family.storedKeyShape !== undefined) {
      if (storedShapeHasOwnKey(family, step.query)) continue;
      const key = family.endpointParams.find((k) => nonEmptyEndpoint(step.query, k) !== null);
      if (key !== undefined)
        warnStoredShape(issues, step.field(key), family.storedKeyShape.provider);
      continue;
    }
    const secret = familySecret(flow, family, step, issues);
    if (secret === null || secret.envName === null) continue;
    const endpointField = familyAuthorEndpoint(flow, family, step, issues);
    if (endpointField === null) continue;
    issues.warn({
      field: endpointField,
      code: CODE,
      message:
        `${endpointField} names an endpoint for ${familyKey} while the step's credential ${secret.field} ` +
        `comes from the server's environment (${secret.envName}). A server-supplied credential is only ` +
        "sent to the executor's default or deployment-configured endpoint, so this step is refused at " +
        "run time unless that endpoint is the deployment's own.",
      suggestion:
        "Supply the endpoint's own credential, or remove the endpoint (or name it by its deployment " +
        "variable) to use the deployment's",
    });
  }
}
