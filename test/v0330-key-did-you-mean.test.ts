// 0.33.0 (AIgentFlow #322): the unknown_yaml_key finding offers the key the author
// most likely meant — the reference's `closeKeys`: the alias table first, then the
// accepted keys within an edit distance of max(2, bytes/3), nearest first, ties in
// sorted order. The shared manifest pins the exact messages both ports print.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateFlow } from '../src/index.js';
import { KEY_ALIASES } from '../src/spec/index.js';
import spec from '../src/spec/aigentflow-spec.json';
import { closeKeys, didYouMean, runeEditDistance } from '../src/validators/keyHints.js';

const here = dirname(fileURLToPath(import.meta.url));
const conformanceDir = join(here, 'conformance');

interface HintCase {
  file: string;
  code: string;
  field: string;
  message: string;
}

const CODE = 'unknown_yaml_key';
const BASE =
  ' AIgentFlow refuses to save a flow with a key its grammar does not declare, because the key would be silently dropped.';

function flowWithStep(extra: string): string {
  return [
    "aigentflow_version: '2.0.0'",
    'name: t',
    "version: '1.0.0'",
    'start: a',
    'steps:',
    '  a:',
    '    executor: mock://api/a',
    extra,
    '    next:',
    "      default: 'null'",
    '',
  ].join('\n');
}

function unknownKeyFinding(yaml: string, field: string): { message: string; suggestion?: string } {
  const hit = validateFlow(yaml).errors.find((e) => e.code === CODE && e.field === field);
  expect(hit, `no ${CODE} at ${field}`).toBeDefined();
  return hit!;
}

describe('unknown_yaml_key: the shared (field, message) table', () => {
  const cases = JSON.parse(
    readFileSync(join(conformanceDir, 'unknown-key-hints-cases.json'), 'utf8'),
  ) as HintCase[];

  it('is not empty', () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  // Exactly these findings: one more (or one fewer) unknown key is a failure too.
  for (const file of [...new Set(cases.map((c) => c.file))]) {
    it(file, () => {
      const result = validateFlow(readFileSync(join(conformanceDir, 'fixtures', file), 'utf8'));
      const got = result.errors
        .filter((e) => e.code === CODE)
        .map((e) => ({ field: e.field, message: e.message }))
        .sort((a, b) => (a.field < b.field ? -1 : 1));
      const want = cases
        .filter((c) => c.file === file)
        .map((c) => ({ field: c.field, message: c.message }))
        .sort((a, b) => (a.field < b.field ? -1 : 1));
      expect(got).toEqual(want);
    });
  }
});

describe('unknown_yaml_key: did you mean', () => {
  it('alias path: `key` in an input_schema field offers `name`', () => {
    const yaml = [
      "aigentflow_version: '2.0.0'",
      'name: t',
      "version: '1.0.0'",
      'input_schema:',
      '  version: 1',
      '  fields:',
      '    - name: topic',
      '      type: string',
      '      key: topic',
      'start: a',
      'steps:',
      '  a:',
      '    executor: mock://api/a',
      '    next:',
      "      default: 'null'",
      '',
    ].join('\n');
    const f = unknownKeyFinding(yaml, 'input_schema.fields[0].key');
    expect(f.message).toBe(
      `Unknown key 'key' in 'input_schema.fields[0]'.${BASE} Did you mean \`name\`?`,
    );
    // The existing suggestion is kept.
    expect(f.suggestion).toMatch(/^Known keys here: accept, default, description, /);
  });

  it('alias path: `params` on a step offers `query`', () => {
    const f = unknownKeyFinding(flowWithStep('    params: {}'), 'steps.a.params');
    expect(f.message).toBe(`Unknown key 'params' in 'steps.a'.${BASE} Did you mean \`query\`?`);
  });

  it('distance path: `excutor` offers `executor`', () => {
    const f = unknownKeyFinding(flowWithStep('    excutor: mock://api/b'), 'steps.a.excutor');
    expect(f.message).toBe(`Unknown key 'excutor' in 'steps.a'.${BASE} Did you mean \`executor\`?`);
  });

  it('no match: no hint at all', () => {
    const f = unknownKeyFinding(flowWithStep('    zzzzzz: 1'), 'steps.a.zzzzzz');
    expect(f.message).toBe(`Unknown key 'zzzzzz' in 'steps.a'.${BASE}`);
    expect(f.message).not.toContain('Did you mean');
  });

  it('an alias target the parent does not accept is not offered', () => {
    // language -> lang: a step has no `lang`, and nothing else is close.
    expect(
      unknownKeyFinding(flowWithStep('    language: go'), 'steps.a.language').message,
    ).not.toContain('Did you mean');
    // input -> query, input_schema: a step accepts only `query`.
    expect(unknownKeyFinding(flowWithStep('    input: {}'), 'steps.a.input').message).toMatch(
      / Did you mean `query`\?$/,
    );
    expect(closeKeys('title', ['description', 'name'])).toEqual(['name']);
  });

  it('a retired key keeps its removal sentence and gets no hint', () => {
    const yaml = [
      "aigentflow_version: '2.0.0'",
      'name: t',
      "version: '1.0.0'",
      'start: fetch',
      'steps:',
      '  fetch:',
      '    executor: mock://api/a',
      '    next:',
      "      default: 'null'",
      'mock_scenarios:',
      '  happy:',
      '    fetch:',
      '      binary_results: []',
      '',
    ].join('\n');
    const f = unknownKeyFinding(yaml, 'mock_scenarios.happy.fetch.binary_results');
    expect(f.message).toContain('It was removed from the grammar');
    expect(f.message).not.toContain('Did you mean');
    // Without the retired rule it WOULD have drawn a hint: the decision is load-bearing.
    expect(closeKeys('binary_results', ['binary_assets', 'content'])).toEqual(['binary_assets']);
  });
});

describe('closeKeys', () => {
  it('multi-match: alias targets first, in TABLE order', () => {
    expect(closeKeys('input', ['input_schema', 'name', 'query'])).toEqual([
      'query',
      'input_schema',
    ]);
    expect(closeKeys('title', ['label', 'name'])).toEqual(['label', 'name']);
  });

  it('multi-match: then nearest first, ties in the order given (sorted by callers)', () => {
    expect(closeKeys('nam', ['enum', 'max', 'min', 'name'])).toEqual(['name', 'enum', 'max']);
    expect(closeKeys('mx_items', ['max_items', 'min_items'])).toEqual(['max_items', 'min_items']);
  });

  it('alias first, then distance, deduplicated', () => {
    expect(closeKeys('id', ['max', 'min', 'name'])).toEqual(['name', 'min']);
    expect(closeKeys('nam', ['name', 'name'])).toEqual(['name']);
  });

  it('matches case-insensitively and looks the alias up lower-cased', () => {
    expect(closeKeys('EXCUTOR', ['executor'])).toEqual(['executor']);
    expect(closeKeys('Params', ['query'])).toEqual(['query']);
  });

  it("folds case as Go's strings.ToLower (U+0130 is i)", () => {
    expect(closeKeys('İD', ['max', 'min', 'name'])).toEqual(['name', 'min']);
  });

  it('measures the threshold in UTF-8 bytes and the distance in code points', () => {
    // 9 code points, 13 bytes: the limit is 13/3 = 4, not 9/3 = 3.
    expect(runeEditDistance('mäx_ïtëmß', 'max_items')).toBe(4);
    expect(closeKeys('mäx_ïtëmß', ['max_items'])).toEqual(['max_items']);
    // An astral code point is one edit, not two UTF-16 units.
    expect(runeEditDistance('a\u{1F600}', 'ab')).toBe(1);
  });

  it('the threshold is max(2, len/3) inclusive', () => {
    expect(closeKeys('ab', ['abcd'])).toEqual(['abcd']); // 2 <= 2
    expect(closeKeys('ab', ['abcde'])).toEqual([]); // 3 > 2
    expect(closeKeys('abcdefghi', ['abcdefxyz'])).toEqual(['abcdefxyz']); // 3 <= 9/3
    expect(closeKeys('abcdefghi', ['abcdewxyz'])).toEqual([]); // 4 > 3
  });

  it('a prototype member name is not an alias', () => {
    expect(closeKeys('constructor', ['name'])).toEqual([]);
    expect(closeKeys('__proto__', ['name'])).toEqual([]);
  });

  it('didYouMean formats with backticks joined by " or "', () => {
    expect(didYouMean('input', ['input_schema', 'query'])).toBe(
      ' Did you mean `query` or `input_schema`?',
    );
    expect(didYouMean('zzzzzz', ['query'])).toBe('');
  });
});

describe('keyAliases in the spec', () => {
  it("is the reference's KEYHINT_ALIASES, verbatim", () => {
    expect(spec.keyAliases).toEqual({
      key: ['name'],
      id: ['name'],
      title: ['label', 'name'],
      desc: ['description'],
      url: ['executor'],
      uri: ['executor'],
      type: ['executor'],
      params: ['query'],
      parameters: ['query'],
      input: ['query', 'input_schema'],
      inputs: ['query', 'input_schema'],
      script: ['query'],
      code: ['expression'],
      expr: ['expression'],
      language: ['lang'],
      retries: ['max_retries'],
      retry: ['error_strategy'],
      timeout: ['max_duration'],
      next_step: ['next'],
      goto: ['next'],
    });
    expect(KEY_ALIASES.size).toBe(20);
  });

  it('every alias is lower-case, so the lower-cased lookup can reach it', () => {
    for (const alias of KEY_ALIASES.keys()) expect(alias).toBe(alias.toLowerCase());
  });
});
