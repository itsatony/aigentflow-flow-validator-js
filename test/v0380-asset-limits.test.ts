// 0.38.0 (AIgentFlow 2.914.0): the inline asset size and the asset count are save-door rules.

import { describe, expect, it } from 'vitest';
import { validateFlow } from '../src/index.js';

const PIN = '2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881';

const flow = (assets: string, query: string): string => `aigentflow_version: "2.0.0"
name: test-flow
version: 1.0.0
start: only
${assets}
steps:
  only:
    executor: function://data/create
    query:
${query}
    next:
      default: 'null'
`;

const errors = (yaml: string) =>
  validateFlow(yaml).errors.filter((e) => e.code.startsWith('asset_'));

const block = (n: number): string =>
  'assets:\n' +
  Array.from({ length: n }, (_, i) => `  a${String(i).padStart(2, '0')}: { content: "x" }`).join(
    '\n',
  );

describe('asset limits (0.38.0)', () => {
  it('counts inline content in UTF-8 bytes, after the pin check', () => {
    const over = 'é'.repeat(131073); // 262146 bytes, 131073 characters
    const at = 'é'.repeat(131072); // exactly 262144 bytes
    expect(errors(flow(`assets:\n  a: { content: "${over}" }`, '      x: asset://a'))).toEqual([
      expect.objectContaining({
        field: 'assets.a',
        code: 'asset_declaration_invalid',
        message: 'asset "a": inline content is larger than 262144 bytes',
      }),
    ]);
    expect(errors(flow(`assets:\n  a: { content: "${at}" }`, '      x: asset://a'))).toEqual([]);
    expect(
      errors(
        flow(`assets:\n  a: { content: "${over}", sha256: "${PIN}" }`, '      x: asset://a'),
      ).map((e) => e.message),
    ).toEqual(['asset "a": inline content takes no sha256 or version']);
  });

  it('more than 32 assets is one finding at field assets, before the per-asset ones', () => {
    expect(errors(flow(block(32), '      x: asset://a00'))).toEqual([]);
    const found = errors(flow(`${block(33)}\n  A: { content: "x" }`, '      x: asset://a00'));
    expect(found).toHaveLength(2);
    expect(found[0]).toMatchObject({
      field: 'assets',
      code: 'asset_declaration_invalid',
      message: 'the flow declares 34 assets, more than 32',
    });
    expect(found[0]?.suggestion).toBeTruthy();
    expect(found[0]?.stepId).toBeUndefined();
  });
});
