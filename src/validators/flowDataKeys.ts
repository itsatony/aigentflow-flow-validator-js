// `flow_data_key_reserved`: a key of the top-level `data:` map may not name
// engine state.
//
// Port of the reference's `FlowDataKeyReservation` /
// `validateFlowDataKeysAreNotReserved`. `data:` is seeded into the mission's
// `.data` namespace before the first step, and that namespace is also where the
// engine keeps its own bookkeeping (the current flow, taint lists, the
// orchestrator's and campaign's state, the memory scope, the mission's
// organization). A flow declaring one of those names writes into engine state
// instead of authoring data, so the save door refuses it. ERROR, with no loop
// demotion: a `data:` block has no loop-body twin.
//
// Matching is exact and case-sensitive over the spec (`flowDataReservedKeys`):
// the `exact` names, then the `prefixes` in order. Keys that merely contain a
// reserved word (`memory_notes`, `orgid`) are legal. Findings are sorted by key.
// The reference's run door tolerates this code on stored flows; this validator
// answers "would this save", so it is an ordinary error here.

import type { Flow } from '../types.js';
import { FLOW_DATA_RESERVED_KEYS } from '../spec/index.js';
import { Issues, isRecord } from './util.js';

const KEY_DATA = 'data';

/** Go's `%q` for a plain string: double-quoted with the escapes JSON shares. */
function quote(key: string): string {
  return JSON.stringify(key);
}

/** Why `key` names engine state, or undefined when it is an author's key. */
export function flowDataKeyReservation(key: string): string | undefined {
  if (Object.prototype.hasOwnProperty.call(FLOW_DATA_RESERVED_KEYS.exact, key)) {
    return FLOW_DATA_RESERVED_KEYS.exact[key];
  }
  for (const p of FLOW_DATA_RESERVED_KEYS.prefixes) {
    if (key.startsWith(p.prefix)) return p.reason;
  }
  return undefined;
}

export function validateFlowDataKeys(flow: Flow, issues: Issues): void {
  const data = flow[KEY_DATA];
  if (!isRecord(data)) return;
  for (const key of Object.keys(data).sort()) {
    const reason = flowDataKeyReservation(key);
    if (reason === undefined) continue;
    issues.error({
      field: FLOW_DATA_RESERVED_KEYS.fieldFormat.replace('%s', () => key),
      message: FLOW_DATA_RESERVED_KEYS.messageFormat
        .replace('%s', () => quote(key))
        .replace('%s', () => reason),
      code: FLOW_DATA_RESERVED_KEYS.code,
      suggestion: FLOW_DATA_RESERVED_KEYS.suggestion,
    });
  }
}
