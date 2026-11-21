// 0.39.0: AIgentFlow v2.917.0 counts the EUROPE residency code (the EU-27 plus
// the GDPR-safe European countries) as EU-bound for
// `compliance_residency_unenforced`. Residency is flow-level, so each shape is
// its own flow.

import { describe, expect, it } from 'vitest';
import { validateFlow } from '../src/index.js';

const CODE = 'compliance_residency_unenforced';

function flow(residency: string, query = ''): string {
  return `aigentflow_version: '2.0.0'
name: t
version: '1.0.0'
compliance:
  residency: ${residency}
start: work
steps:
  work:
    executor: 'ai://mistral/chat'
    query:
      model: m
      prompt: hi
${query}
    next:
      default: 'null'
`;
}

const warnings = (y: string) => validateFlow(y).warnings.filter((w) => w.code === CODE);

describe('EUROPE is EU-bound', () => {
  it.each([["['EUROPE']"], ["['EU', 'EUROPE']"], ["[' europe ']"], ["['DE', 'Europe']"]])(
    'warns on an unpinned region-lane call under %s',
    (residency) => {
      const r = validateFlow(flow(residency));
      expect(r.valid).toBe(true);
      expect(warnings(flow(residency))).toHaveLength(1);
    },
  );

  it.each([["['EUROPE', 'US']"], ["['EUROPEAN']"], ["['EEA']"]])(
    'is silent when the residency is not EU-bound: %s',
    (residency) => {
      expect(warnings(flow(residency))).toHaveLength(0);
    },
  );

  it('is silent when the call is pinned', () => {
    expect(warnings(flow("['EUROPE']", '      region: eu'))).toHaveLength(0);
  });
});
