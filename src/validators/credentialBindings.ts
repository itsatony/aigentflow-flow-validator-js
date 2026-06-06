// Step credential-binding validation.
//
// Mirrors `validateStepCredentialBindings` (parser.go): `credentials` and
// `credential` are mutually exclusive; every source must be
// `stored/{provider}/{name}` with non-empty provider and name; explicit
// bindings require a non-empty `inject_as`. Applies to loop sub-steps too.

import type { CredentialBinding, Flow, LoopSubStep } from '../types.js';
import { CREDENTIAL_REFERENCE_PREFIX } from '../spec/index.js';
import { Issues, isRecord, isString } from './util.js';

function hasPrefix(source: string): boolean {
  return (
    source.length > CREDENTIAL_REFERENCE_PREFIX.length &&
    source.startsWith(CREDENTIAL_REFERENCE_PREFIX)
  );
}

// Matches Go's isValidCredentialSourceFormat: first '/' after the prefix must
// have a non-empty provider before it and a non-empty name after it.
function hasValidFormat(source: string): boolean {
  const rest = source.slice(CREDENTIAL_REFERENCE_PREFIX.length);
  const idx = rest.indexOf('/');
  return idx > 0 && idx < rest.length - 1;
}

interface StepCreds {
  credential?: unknown;
  credentials?: unknown;
}

function checkBindings(creds: StepCreds, fieldBase: string, stepID: string, issues: Issues): void {
  const credentialsMap = creds.credentials;
  const credential = creds.credential;
  const hasCredentialsMap = isRecord(credentialsMap) && Object.keys(credentialsMap).length > 0;
  const hasShorthand = isString(credential) && credential !== '';

  if (hasCredentialsMap && hasShorthand) {
    issues.error({
      field: fieldBase,
      message: `Step '${stepID}' cannot set both 'credentials' and 'credential'`,
      code: 'cred_bind_mutual_exclusive',
      stepId: stepID,
    });
  }

  if (isRecord(credentialsMap)) {
    for (const [bindingName, rawBinding] of Object.entries(credentialsMap)) {
      if (rawBinding === null || rawBinding === undefined) continue;
      if (!isRecord(rawBinding)) {
        issues.error({
          field: `${fieldBase}s.${bindingName}`,
          message: `Credential binding '${bindingName}' must be a mapping`,
          code: 'invalid_type',
          stepId: stepID,
        });
        continue;
      }
      const binding = rawBinding as CredentialBinding;
      const source = binding.source;
      if (!isString(source) || !hasPrefix(source)) {
        issues.error({
          field: `${fieldBase}s.${bindingName}.source`,
          message: `Credential binding '${bindingName}' source must start with '${CREDENTIAL_REFERENCE_PREFIX}'`,
          code: 'cred_bind_invalid_source',
          stepId: stepID,
        });
      } else if (!hasValidFormat(source)) {
        issues.error({
          field: `${fieldBase}s.${bindingName}.source`,
          message: `Credential binding '${bindingName}' source must be '${CREDENTIAL_REFERENCE_PREFIX}{provider}/{name}'`,
          code: 'cred_bind_source_format',
          stepId: stepID,
        });
      }
      if (!isString(binding.inject_as) || binding.inject_as === '') {
        issues.error({
          field: `${fieldBase}s.${bindingName}.inject_as`,
          message: `Credential binding '${bindingName}' requires a non-empty 'inject_as'`,
          code: 'cred_bind_inject_as_empty',
          stepId: stepID,
        });
      }
    }
  }

  if (hasShorthand) {
    const c = credential as string;
    if (!hasPrefix(c)) {
      issues.error({
        field: fieldBase,
        message: `Shorthand credential must start with '${CREDENTIAL_REFERENCE_PREFIX}'`,
        code: 'cred_bind_shorthand_source',
        stepId: stepID,
      });
    } else if (!hasValidFormat(c)) {
      issues.error({
        field: fieldBase,
        message: `Shorthand credential must be '${CREDENTIAL_REFERENCE_PREFIX}{provider}/{name}'`,
        code: 'cred_bind_shorthand_format',
        stepId: stepID,
      });
    }
  }
}

export function validateCredentialBindings(flow: Flow, issues: Issues): void {
  const steps = flow.steps;
  if (!isRecord(steps)) return;

  for (const [stepID, step] of Object.entries(steps)) {
    if (!isRecord(step)) continue;
    checkBindings(step as StepCreds, `steps.${stepID}.credential`, stepID, issues);

    const loop = step.loop;
    if (isRecord(loop) && Array.isArray(loop.steps)) {
      loop.steps.forEach((sub: unknown, i: number) => {
        if (!isRecord(sub)) return;
        const subStep = sub as LoopSubStep;
        const subID = isString(subStep.id) ? subStep.id : String(i);
        checkBindings(
          subStep as StepCreds,
          `steps.${stepID}.loop.steps[${i}].credential`,
          `${stepID}.${subID}`,
          issues,
        );
      });
    }
  }
}
