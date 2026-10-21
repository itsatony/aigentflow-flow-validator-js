// 0.30.0 — AIgentFlow v2.841.0: `for_each.items` that is neither a template nor a
// JSON array (`for_each_items_unresolvable`). The conformance fixtures carry the
// verdicts; these tests pin the fires / does-not-fire matrix, the addressing and
// the message.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateFlow } from '../src/index.js';

const CODE = 'for_each_items_unresolvable';

const flowWith = (itemsLine: string, extraStep = ''): string => `aigentflow_version: "2.0.0"
name: test-flow
version: 1.0.0
start: fan
steps:
  fan:
    executor: function://utils/log
    for_each:
      items: ${itemsLine}
      as: item
    query:
      message: "{{ .each.item }}"
${extraStep}`;

const unresolvable = (r: ReturnType<typeof validateFlow>) =>
  r.errors.filter((e) => e.code === CODE);

describe('for_each_items_unresolvable: fires', () => {
  it.each([
    ['a bare path', '".data.seed.list"'],
    ['plain text', '"a, b, c"'],
    ['an object literal', `'{"a": 1}'`],
    ['null', '"null"'],
    ['a number', '"42"'],
    ['a JSON string', `'"str"'`],
    ['an unquoted number (read as its source text)', '5'],
    ['an unquoted boolean (read as its source text)', 'true'],
    ['whitespace only (non-empty, not an array)', '"   "'],
    ['invalid JSON', '"[1,"'],
  ])('%s', (_name, line) => {
    const r = validateFlow(flowWith(line));
    expect(unresolvable(r)).toHaveLength(1);
    expect(r.errors).toHaveLength(1);
    expect(r.valid).toBe(false);
    const e = unresolvable(r)[0];
    expect(e?.field).toBe('steps.fan.for_each.items');
    expect(e?.stepId).toBe('fan');
    expect(e?.severity).toBe('error');
    expect(e?.suggestion).toBe('Wrap the path in braces: {{ .data.<step>.<field> }}');
  });
});

describe('for_each_items_unresolvable: does not fire', () => {
  it.each([
    ['a template', '"{{ .data.seed.list }}"'],
    ['a template with surrounding text', '"x {{ .data.a }} y"'],
    ['a JSON array', `'["a","b"]'`],
    ['the empty array', '"[]"'],
    ['an array with surrounding whitespace', '" [1,2] "'],
    ['an unclosed template (templates are judged elsewhere)', '"{{ .data.a"'],
  ])('%s', (_name, line) => {
    expect(unresolvable(validateFlow(flowWith(line)))).toHaveLength(0);
  });

  it('adds no finding for an empty or missing items (for_each_items_required owns it)', () => {
    const r = validateFlow(flowWith('""'));
    expect(unresolvable(r)).toHaveLength(0);
    expect(r.errors.map((e) => e.code)).toContain('for_each_items_required');
  });

  it('adds no finding for a mapping or list', () => {
    for (const line of ['[1, 2]', '{a: 1}']) {
      expect(unresolvable(validateFlow(flowWith(line)))).toHaveLength(0);
    }
  });

  it('judges top-level steps only (a loop sub-step has no for_each)', () => {
    const doc = `aigentflow_version: "2.0.0"
name: test-flow
version: 1.0.0
start: lp
steps:
  lp:
    loop:
      while: "{{ true }}"
      max_iterations: 2
      steps:
        - id: sub
          executor: function://utils/log
          for_each:
            items: ".data.x"
`;
    expect(unresolvable(validateFlow(doc))).toHaveLength(0);
  });
});

describe('for_each_items_unresolvable: message', () => {
  it('is the contract text, quoting the value', () => {
    const e = unresolvable(validateFlow(flowWith('".data.seed.list"')))[0];
    expect(e?.message).toBe(
      `for_each.items ".data.seed.list" is neither a template ({{ … }}) nor a JSON array, so it can never resolve to a list; write {{ .data.<step>.<field> }} to read a value, or a JSON array literal such as '["a","b"]'`,
    );
  });

  it('truncates the quoted value to 60 code points with an ellipsis', () => {
    const long = 'é'.repeat(61);
    const e = unresolvable(validateFlow(flowWith(`"${long}"`)))[0];
    expect(e?.message).toContain(`"${'é'.repeat(60)}…"`);
    const exact = 'é'.repeat(60);
    const e2 = unresolvable(validateFlow(flowWith(`"${exact}"`)))[0];
    expect(e2?.message).toContain(`"${exact}"`);
    expect(e2?.message).not.toContain('…"');
  });
});

describe('for_each_items_unresolvable: fixtures yield exactly the one code', () => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), 'conformance', 'fixtures');
  it.each([
    'invalid-for-each-items-bare-path.yaml',
    'invalid-for-each-items-null-literal.yaml',
    'invalid-for-each-items-object-literal.yaml',
    'invalid-for-each-items-plain-text.yaml',
  ])('%s', (file) => {
    const r = validateFlow(readFileSync(join(dir, file), 'utf8'));
    expect(r.errors.map((e) => e.code)).toEqual([CODE]);
  });

  it('valid-for-each-items-forms.yaml has no errors and no warnings', () => {
    const r = validateFlow(readFileSync(join(dir, 'valid-for-each-items-forms.yaml'), 'utf8'));
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
  });
});
