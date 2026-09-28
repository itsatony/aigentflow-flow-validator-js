// `executor_config_env_scope`: an `executor_config:` value may name only the
// environment variables of the key it is written under.
//
// Port of the reference's `ValidateExecutorConfigEnvScopes` (AIgentFlow
// v2.597.0), which the save door applies to the whole block. `executor_config`
// is author-written, so without it an author could point `base_url` at their
// own endpoint and have the server expand a secret that belongs to another
// provider into `api_key`.
//
// The checked values are the three Go-`string` fields (`api_key`, `base_url`,
// `organization`), read by SOURCE TEXT like every string field, and every YAML
// STRING in `extra` (the reference type-asserts `.(string)` on an `any`, so a
// number there is never a reference). A value is a reference when it is exactly
// `${NAME}` with NAME non-empty; `${A}${B}` is the single name `A}${B` and is
// refused unless a scope names it, as in the reference.
//
// The scopes are the reference's scope function evaluated for every key that
// has one (spec `executorConfigEnvScopes.scopes`). Any other key has an EMPTY
// scope and refuses every reference: the reference reads those values raw, so a
// `${...}` there would be sent verbatim as a credential.
//
// The reference stops at the first violation (a parse-door refusal); this
// validator reports each one. The verdict is the same.

import type { Flow } from '../types.js';
import { EXECUTOR_CONFIG_ENV_SCOPES } from '../spec/index.js';
import { Issues, isRecord, isString } from './util.js';

const KEY_EXECUTOR_CONFIG = 'executor_config';
const CODE = 'executor_config_env_scope';
const NO_SCOPE: readonly string[] = [];

export function validateExecutorConfigEnvScopes(flow: Flow, issues: Issues): void {
  const config: unknown = flow[KEY_EXECUTOR_CONFIG];
  if (!isRecord(config)) return;
  const { fields, extraKey, scopes } = EXECUTOR_CONFIG_ENV_SCOPES;

  for (const configKey of Object.keys(config).sort()) {
    const instance = config[configKey];
    // null is skipped by the reference; any other non-mapping is an
    // `invalid_type` from the unknown-keys rule.
    if (!isRecord(instance)) continue;
    const base = `${KEY_EXECUTOR_CONFIG}.${configKey}`;
    // Own properties only: `constructor` or `toString` is an ordinary key with
    // an empty scope, not a lookup into Object.prototype.
    const scope = Object.prototype.hasOwnProperty.call(scopes, configKey)
      ? (scopes[configKey] ?? NO_SCOPE)
      : NO_SCOPE;

    for (const field of fields) {
      const value = issues.stringOf(instance, field, base);
      if (value === null) continue;
      checkReference(issues, `${base}.${field}`, configKey, field, value, scope);
    }
    const extra = instance[extraKey];
    if (!isRecord(extra)) continue;
    for (const extraName of Object.keys(extra).sort()) {
      const value = extra[extraName];
      if (!isString(value)) continue;
      checkReference(
        issues,
        `${base}.${extraKey}.${extraName}`,
        configKey,
        `${extraKey}.${extraName}`,
        value,
        scope,
      );
    }
  }
}

function checkReference(
  issues: Issues,
  field: string,
  configKey: string,
  fieldName: string,
  value: string,
  scope: readonly string[],
): void {
  const name = envReferenceName(value);
  if (name === null || scope.includes(name)) return;
  const permitted =
    scope.length > 0 ? scope.join(', ') : '(none: this key expands no environment variables)';
  issues.error({
    field,
    code: CODE,
    message:
      `executor_config key '${configKey}' sets ${fieldName} to environment variable '${name}', ` +
      'which it may not expand; a flow may only expand the variables belonging to the provider ' +
      `or protocol it writes them under. Permitted here: ${permitted}`,
    suggestion:
      'To use an organisation secret, bind a stored credential on the step instead: ' +
      'credentials: {<name>: {source: "stored/<provider>/<credential>", inject_as: "api_key"}}',
  });
}

/** The reference's isAuthorEnvReference: exactly `${NAME}`, NAME non-empty. */
export function envReferenceName(value: string): string | null {
  const { referencePrefix: prefix, referenceSuffix: suffix } = EXECUTOR_CONFIG_ENV_SCOPES;
  if (
    value.length < prefix.length + suffix.length ||
    !value.startsWith(prefix) ||
    !value.endsWith(suffix)
  ) {
    return null;
  }
  const name = value.slice(prefix.length, value.length - suffix.length);
  return name === '' ? null : name;
}
