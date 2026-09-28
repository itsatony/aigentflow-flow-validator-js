// `server_owned_query_key`: a step's `query:`, or a loop sub-step's `query:`,
// may not declare an executor parameter only the server sets.
//
// Port of the reference's `validateNoServerOwnedStepQueryKeys` /
// `IsServerOwnedParamKey` (AIgentFlow CFX-05). The `aiv://` executor sends the
// running org's aigentverse credential, or a signed token naming the running
// person, to the base URL in its parameters, and the reference used to lay a
// step's query over the credential resolver's output — so a shared flow
// declaring `aiv_base_url: https://attacker.example` chose where that
// credential went. The engine now discards such a value at run time; this is
// the named refusal at save. ERROR: no legitimate flow sets these keys.
//
// Matching is exact and case-sensitive, over the key set in the spec
// (`serverOwnedQueryKeys.keys`). Exactly the reference's two surfaces are
// scanned: a top-level step's `query:` and a loop sub-step's `query:`. A
// parallel branch or a for_each body is a top-level step. Any value is refused,
// null and templates included.
//
// A loop sub-step is addressed by its id as written (source text, like every
// Go-string field). A sub-step without an id is addressed by the empty string,
// the reference's format with its zero value; the reference itself refuses the
// missing id at parse (`loop_step_id_required` here), so the verdict is the same.

import type { Flow } from '../types.js';
import { SERVER_OWNED_QUERY_KEYS } from '../spec/index.js';
import { loopSubStepsOfStep } from './processingOperations.js';
import { Issues, isRecord } from './util.js';

const CODE = 'server_owned_query_key';
const KEY_QUERY = 'query';
const KEY_ID = 'id';
const SERVER_OWNED: ReadonlySet<string> = new Set(SERVER_OWNED_QUERY_KEYS.keys);

/** Go's `fmt.Sprintf` for the `%s`-only field formats in the spec. */
function formatField(format: string, ...args: string[]): string {
  let i = 0;
  return format.replace(/%s/g, () => args[i++] ?? '');
}

export function validateServerOwnedQueryKeys(flow: Flow, issues: Issues): void {
  const steps = flow.steps;
  if (!isRecord(steps)) return;
  for (const stepID of Object.keys(steps).sort()) {
    const step = steps[stepID];
    if (!isRecord(step)) continue;
    const query = (step as Record<string, unknown>)[KEY_QUERY];
    if (isRecord(query)) {
      for (const key of Object.keys(query).sort()) {
        if (!SERVER_OWNED.has(key)) continue;
        refuse(
          issues,
          stepID,
          key,
          formatField(SERVER_OWNED_QUERY_KEYS.stepFieldFormat, stepID, key),
        );
      }
    }
    for (const sub of loopSubStepsOfStep(stepID, step)) {
      const subQuery = sub.raw[KEY_QUERY];
      if (!isRecord(subQuery)) continue;
      const subID = issues.stringOf(sub.raw, KEY_ID, sub.basePath) ?? '';
      for (const key of Object.keys(subQuery).sort()) {
        if (!SERVER_OWNED.has(key)) continue;
        refuse(
          issues,
          stepID,
          key,
          formatField(SERVER_OWNED_QUERY_KEYS.loopStepFieldFormat, stepID, subID, key),
        );
      }
    }
  }
}

function refuse(issues: Issues, stepId: string, key: string, field: string): void {
  issues.error({
    field,
    message: `query key '${key}' on step '${stepId}' is set by the server only (it carries the aigentverse credential and where it is sent), so a flow may not declare it`,
    code: CODE,
    stepId,
    suggestion:
      "Remove it: the running org's aigentverse connection, or the signed-in person, is used automatically",
  });
}
