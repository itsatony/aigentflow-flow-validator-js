// 0.37.0 (AIgentFlow 2.913.0): assets — long step bodies kept outside the flow.

import { describe, expect, it } from 'vitest';
import { validateFlow } from '../src/index.js';

const PIN = '2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881';

const flow = (assets: string, query: string, extra = ''): string => `aigentflow_version: "2.0.0"
name: test-flow
version: 1.0.0
start: only
${assets}
steps:
  only:
    executor: function://data/create
${extra}    query:
${query}
    next:
      default: 'null'
`;

const errors = (yaml: string) =>
  validateFlow(yaml).errors.filter((e) => e.code.startsWith('asset_'));

describe('assets (0.37.0)', () => {
  it('accepts the three source forms and references at the sites', () => {
    const yaml = flow(
      `assets:
  a: { content: "hello" }
  b: { trove_key: "k", sha256: "${PIN}" }
  c: { aiv_ref: "acme/p", version: "1.2.0-rc.1", sha256: "${PIN.toUpperCase()}" }`,
      `      x: asset://a
      y: [asset://b, { z: asset://c }]`,
    );
    const result = validateFlow(yaml);
    expect(result.errors).toEqual([]);
    expect(result.warnings.map((w) => w.code)).not.toContain('unknown_yaml_key');
  });

  it('a value with whitespace or a longer string is prose, not a reference', () => {
    expect(
      errors(
        flow(
          'assets: { a: { content: "x" } }',
          `      x: "asset://nope "\n      y: see asset://nope`,
        ),
      ),
    ).toEqual([]);
  });

  it('names each declaration problem in the reference order, with its text', () => {
    const cases: Array<[string, string]> = [
      [
        'A: { content: "x" }',
        'asset "A": the name "A" must be lowercase letters, digits, - and _, starting with a letter (at most 64)',
      ],
      ['a: {}', 'asset "a": it names no source: set exactly one of content, trove_key or aiv_ref'],
      ['a:', 'asset "a": it names no source: set exactly one of content, trove_key or aiv_ref'],
      [
        `a: { content: "x", aiv_ref: "acme/p", version: "1.0.0", sha256: "${PIN}" }`,
        'asset "a": it names more than one source: set exactly one of content, trove_key or aiv_ref',
      ],
      [
        `a: { content: "x", sha256: "${PIN}" }`,
        'asset "a": inline content takes no sha256 or version',
      ],
      [
        'a: { trove_key: "k", sha256: "abc" }',
        'asset "a": a trove_key or aiv_ref asset needs its sha256 (64 hex characters) so the run reads exactly the text the flow was written for',
      ],
      [
        `a: { trove_key: "k", version: "1.0.0", sha256: "${PIN}" }`,
        'asset "a": a trove_key asset takes no version; its sha256 pins it',
      ],
      [
        `a: { aiv_ref: "acme/p", version: "1.0", sha256: "${PIN}" }`,
        'asset "a": an aiv_ref asset needs its published version (MAJOR.MINOR.PATCH)',
      ],
      [
        `a: { aiv_ref: "acme/team/p", version: "1.0.0", sha256: "${PIN}" }`,
        'asset "a": aiv_ref must be <org>/<name> (the aigentverse org handle and the entity\'s name)',
      ],
    ];
    for (const [decl, message] of cases) {
      const found = errors(flow(`assets:\n  ${decl}`, '      x: plain'));
      expect(found.map((e) => e.message)).toEqual([message]);
      expect(found[0]?.field).toMatch(/^assets\./);
    }
  });

  it('a reference to an undeclared (or null) asset is an error naming the step', () => {
    const found = errors(flow('assets:\n  a:', '      x: asset://a\n      y: asset://b'));
    expect(found.map((e) => [e.code, e.message, e.field, e.stepId])).toEqual([
      [
        'asset_declaration_invalid',
        'asset "a": it names no source: set exactly one of content, trove_key or aiv_ref',
        'assets.a',
        undefined,
      ],
      [
        'asset_reference_unknown',
        "step only uses asset://a, which the flow's assets: block does not declare",
        'steps.only',
        'only',
      ],
      [
        'asset_reference_unknown',
        "step only uses asset://b, which the flow's assets: block does not declare",
        'steps.only',
        'only',
      ],
    ]);
  });

  it('refuses a reference outside the sites, before the unknown ones', () => {
    const found = errors(
      flow(
        'assets: { a: { content: "x" } }',
        '      x: plain',
        '    description: asset://a\n    condition: asset://zz\n',
      ),
    );
    expect(found.map((e) => [e.code, e.message])).toEqual([
      [
        'asset_reference_placement',
        "step only uses asset://a outside its query, its quality_gate rubric or a loop sub-step's query; only those values may come from an asset",
      ],
      [
        'asset_reference_placement',
        "step only uses asset://zz outside its query, its quality_gate rubric or a loop sub-step's query; only those values may come from an asset",
      ],
      [
        'asset_reference_unknown',
        "step only uses asset://zz, which the flow's assets: block does not declare",
      ],
    ]);
  });

  it('a quality_gate rubric is a site; its other keys are not', () => {
    expect(
      errors(
        flow(
          'assets: { a: { content: "x" } }',
          '      x: plain',
          '    quality_gate:\n      rubric: asset://a\n',
        ),
      ),
    ).toEqual([]);
    expect(
      errors(
        flow(
          'assets: { a: { content: "x" } }',
          '      x: plain',
          '    quality_gate:\n      rubric: r\n      model: asset://a\n',
        ),
      ).map((e) => e.code),
    ).toEqual(['asset_reference_placement']);
  });

  it('an unknown key inside an asset is refused like any unknown key', () => {
    const result = validateFlow(
      flow('assets: { a: { content: "x", sha: "y" } }', '      x: asset://a'),
    );
    expect([...result.errors, ...result.warnings].map((e) => e.code)).toContain('unknown_yaml_key');
  });
});
