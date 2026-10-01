// 0.15.3: the optional top-level `display_name` (AIgentFlow #187). The
// conformance fixtures pin the verdicts; these pin the field path, the count in
// the message, and the code-point (not UTF-16) counting.

import { describe, expect, it } from 'vitest';
import { validateFlow } from '../src/index.js';

const flow = (displayName: string): string => `aigentflow_version: "2.0.0"
name: test-flow
version: 1.0.0
display_name: ${JSON.stringify(displayName)}
start: only
steps:
  only:
    executor: function://text/noop
`;

describe('display_name', () => {
  it('accepts exactly 80 ASCII characters', () => {
    expect(validateFlow(flow('a'.repeat(80))).valid).toBe(true);
  });

  it('refuses 81 and names the field and the count', () => {
    const r = validateFlow(flow('a'.repeat(81)));
    expect(r.valid).toBe(false);
    const e = r.errors.find((x) => x.code === 'display_name_too_long');
    expect(e?.field).toBe('display_name');
    expect(e?.message).toBe('display_name is 81 characters; the limit is 80');
  });

  it('counts an astral character as one', () => {
    expect(validateFlow(flow('\u{1F600}'.repeat(80))).valid).toBe(true);
    expect(validateFlow(flow('\u{1F600}'.repeat(81))).valid).toBe(false);
  });

  it('is optional', () => {
    expect(validateFlow(flow('')).errors.map((x) => x.code)).not.toContain('display_name_too_long');
  });
});
