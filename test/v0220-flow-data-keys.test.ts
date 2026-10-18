// 0.22.0: flow_data_key_reserved. The conformance fixtures pin the verdict per
// reserved shape; these pin the full reserved set, the legal look-alikes, and
// what a verdict cannot show — the exact field, message, suggestion and order.

import { describe, expect, it } from 'vitest';
import { validateFlow } from '../src/index.js';
import { FLOW_DATA_RESERVED_KEYS } from '../src/spec/index.js';

const CODE = 'flow_data_key_reserved';

const withData = (lines: string[]): string => `aigentflow_version: "2.0.0"
name: test-flow
version: 1.0.0
start: only
data:
${lines.map((l) => `  ${l}`).join('\n')}
steps:
  only:
    executor: function://text/noop
`;

const reservedFindings = (lines: string[]) =>
  validateFlow(withData(lines)).errors.filter((e) => e.code === CODE);

const RESERVED = [
  'memory',
  'orchestrator',
  'campaign',
  'voiceagent',
  'org_id',
  'current_flow',
  'modified_flow',
  'modification_history',
  'modification_pending',
  'modification_requests',
  'bottleneck_state',
  '_current_flow',
  '_llm_priority',
  '__untrusted_steps',
  '__untrusted_outputs',
  '_loop_context',
  '.step.response',
  '.x',
  'memory.scope_id',
  'orchestrator.state',
  'campaign.state',
  'voiceagent.session_id',
];

const LEGAL = [
  'versuche',
  'counter',
  'x',
  'limit',
  'my.key',
  'memory_notes',
  'orgid',
  'org',
  'my_memory',
  'orchestrated',
  'campaigns',
  'Memory',
  'ORG_ID',
  'budget.max',
  'a_b',
];

const q = (k: string): string => `"${k}"`;

describe('flow_data_key_reserved', () => {
  it('the spec lists exactly the reference exact names', () => {
    expect(Object.keys(FLOW_DATA_RESERVED_KEYS.exact).sort()).toEqual(
      [
        'memory',
        'orchestrator',
        'campaign',
        'voiceagent',
        'org_id',
        'current_flow',
        'modified_flow',
        'modification_history',
        'modification_pending',
        'modification_requests',
        'bottleneck_state',
      ].sort(),
    );
    expect(FLOW_DATA_RESERVED_KEYS.prefixes.map((p) => p.prefix)).toEqual([
      '_',
      '.',
      'memory.',
      'orchestrator.',
      'campaign.',
      'voiceagent.',
    ]);
  });

  for (const key of RESERVED) {
    it(`refuses ${key}`, () => {
      const found = reservedFindings([`${q(key)}: x`]);
      expect(found).toHaveLength(1);
      expect(found[0]!.field).toBe(`data.${key}`);
      expect(found[0]!.message.startsWith(`data: key ${q(key)} is reserved: `)).toBe(true);
      expect(
        found[0]!.message.endsWith(
          ". It would write into the engine's own state, so it is not seeded.",
        ),
      ).toBe(true);
      expect(found[0]!.suggestion).toBe(FLOW_DATA_RESERVED_KEYS.suggestion);
      expect(validateFlow(withData([`${q(key)}: x`])).valid).toBe(false);
    });
  }

  for (const key of LEGAL) {
    it(`keeps ${key} legal`, () => {
      expect(reservedFindings([`${q(key)}: x`])).toEqual([]);
    });
  }

  it('reports one finding per key, sorted by key, and spares the author keys', () => {
    const found = reservedFindings([
      'ok_key: kept',
      '"orchestrator.state": forged',
      '"__untrusted_steps": [forged]',
      'org_id: someone-elses-org',
    ]);
    expect(found.map((e) => e.field)).toEqual([
      'data.__untrusted_steps',
      'data.orchestrator.state',
      'data.org_id',
    ]);
  });

  it('is an error, never a warning, and a flow without data: is untouched', () => {
    const r = validateFlow(withData(['memory: x']));
    expect(r.warnings.some((w) => w.code === CODE)).toBe(false);
    const none = validateFlow(`aigentflow_version: "2.0.0"
name: test-flow
version: 1.0.0
start: only
steps:
  only:
    executor: function://text/noop
`);
    expect(none.errors.some((e) => e.code === CODE)).toBe(false);
  });
});
