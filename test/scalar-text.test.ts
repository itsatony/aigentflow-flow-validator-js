// 0.14.1: a scalar the reference decodes into a Go `string` field is read here
// as the text that field receives — its SOURCE spelling. yaml.v3 fills a Go
// `string` (a field, or a `map[string]…` key such as the step table) from any
// scalar by its text; the `yaml` package resolves the same scalar to a number
// or boolean first (`1.0` → 1, `0x1F` → 31, `True` → true, `-0` → -0), so the
// text has to be recovered from the parsed node, never from the JS value.
//
// Every expected verdict below was measured on the reference's strict save
// parser by the Go port (go-aigentflow-validator v0.5.1,
// TestStringTypedFieldsReadNumbersAsText); the spellings are the ones it pins
// against yaml.v3 itself in TestYAMLStringFieldReceivesSourceText.

import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';
import { validateFlow, validateFlowObject, type ValidationResult } from '../src/index.js';
import { parseFlow } from '../src/parse.js';
import { Issues, isRecord } from '../src/validators/util.js';

/** Every scalar kind whose resolved value, in either parser, is not its text. */
const SPELLINGS = [
  '2',
  '-0',
  '+1',
  '017',
  '0o17',
  '0x1F',
  '1_000', // !!int (yaml.v3)
  '1e3',
  '.5',
  '0.10',
  '.inf', // !!float
  'true',
  'True',
  'FALSE', // !!bool
  '2024-01-01', // !!timestamp (yaml.v3)
];

function codes(r: ValidationResult): string[] {
  return r.errors.map((e) => e.code);
}

describe('a Go string field receives the source text of a scalar', () => {
  it('the premise: the `yaml` package loses the text in the resolved value', () => {
    // If this ever stops failing for these spellings, the recovery below is
    // no longer needed — but the test pins that it is needed today.
    const lost = SPELLINGS.filter((lit) => {
      const v: unknown = parseDocument(`v: ${lit}\n`).toJS();
      return !isRecord(v) || v.v !== lit;
    });
    expect(lost).toEqual(
      expect.arrayContaining(['2', '-0', '+1', '017', '0x1F', '1e3', '.5', '0.10', '.inf', 'True']),
    );
  });

  for (const lit of SPELLINGS) {
    it(`${lit}: as a step key and as a value`, () => {
      const src = `v: ${lit}\nsteps:\n  ${lit}: x\n`;
      const { flow, parseErrors, scalarSources } = parseFlow(src);
      expect(parseErrors).toEqual([]);
      const steps = (flow as Record<string, unknown>).steps as Record<string, unknown>;
      expect(Object.keys(steps)).toEqual([lit]);
      const issues = new Issues(scalarSources);
      expect(issues.stringOf(flow as object, 'v', '')).toBe(lit);
    });
  }

  it('a null is absent, and a mapping or list is not a string', () => {
    const { flow, scalarSources } = parseFlow('a: ~\nb: {x: 1}\nc: [1]\nd: ""\n');
    const issues = new Issues(scalarSources);
    expect(issues.stringOf(flow as object, 'a', '')).toBeNull();
    expect(issues.stringOf(flow as object, 'b', '')).toBeNull();
    expect(issues.stringOf(flow as object, 'c', '')).toBeNull();
    expect(issues.stringOf(flow as object, 'd', '')).toBe('');
  });

  it('keys collide by TEXT, as yaml.v3 decides it', () => {
    // `1` and `1.0` are two steps to the reference; `"1"` and `1` are one.
    const two = parseFlow('steps:\n  1: x\n  1.0: y\n');
    expect(two.parseErrors).toEqual([]);
    const twoSteps = (two.flow as Record<string, unknown>).steps as Record<string, unknown>;
    expect(Object.keys(twoSteps)).toEqual(['1', '1.0']);
    const one = parseFlow('steps:\n  "1": x\n  1: y\n');
    expect(one.parseErrors.map((e) => e.code)).toContain('duplicate_key');
  });
});

describe('every rule that reads a Go string field reads a number as text', () => {
  const head = "aigentflow_version: '2.0.0'\nname: p\nstart: a\n";
  const tail = "    next: {default: 'null'}\n";
  const step = (body: string): string =>
    `${head}steps:\n  a:\n    executor: mock://x/y\n${body}${tail}`;

  interface Case {
    name: string;
    src: string;
    /** Undefined: the reference saves it. */
    wantError?: string;
    field?: string;
    /** Error codes that must not appear. */
    forbid?: string[];
    /** The reference ALSO reports unreachable_step (a quality_gate goto is not an edge). */
    unreachable?: boolean;
  }
  const cases: Case[] = [
    {
      name: 'flow name',
      src: `aigentflow_version: '2.0.0'\nname: 123\nstart: a\nsteps:\n  a:\n    executor: mock://x/y\n${tail}`,
      forbid: ['missing_required_field'],
    },
    {
      name: 'aigentflow_version',
      src: `aigentflow_version: 2.0\nname: p\nstart: a\nsteps:\n  a:\n    executor: mock://x/y\n${tail}`,
      forbid: ['missing_required_field'],
    },
    {
      name: 'start',
      src: `aigentflow_version: '2.0.0'\nname: p\nstart: 1\nsteps:\n  1:\n    executor: mock://x/y\n${tail}`,
      forbid: ['missing_required_field', 'step_not_found'],
    },
    {
      name: 'error_strategy action',
      src: step('    error_strategy:\n      action: 1\n'),
      wantError: 'invalid_error_strategy_action',
      field: 'steps.a.error_strategy.action',
    },
    {
      name: 'flow-level error_strategy goto_step',
      src: `${head}error_strategy:\n  action: goto\n  goto_step: 2\nsteps:\n  a:\n    executor: mock://x/y\n${tail}  2:\n    executor: mock://x/y\n${tail}`,
      forbid: ['goto_step_missing'],
    },
    {
      name: 'quality_gate on_fail',
      src: step('    quality_gate:\n      rubric: good\n      on_fail: 1\n'),
      wantError: 'quality_gate_invalid_on_fail',
      field: 'steps.a.quality_gate.on_fail',
    },
    {
      name: 'quality_gate goto_step',
      src: `${step('    quality_gate:\n      rubric: good\n      on_fail: goto\n      goto_step: 2\n')}  2:\n    executor: mock://x/y\n${tail}`,
      forbid: ['quality_gate_goto_missing'],
      unreachable: true,
    },
    {
      name: 'quality_gate rubric',
      src: step('    quality_gate:\n      rubric: 5\n'),
      forbid: ['quality_gate_missing_rubric'],
    },
    {
      name: 'rendezvous names no step',
      src: `${head}steps:\n  a:\n    executor: mock://x/y\n    next:\n      parallel:\n        steps: [b]\n        rendezvous: 9\n  b:\n    executor: mock://x/y\n`,
      wantError: 'step_not_found',
      field: 'steps.a.next.parallel.rendezvous',
    },
    {
      name: 'for_each resolution',
      src: step("    for_each:\n      items: '{{ .query.xs }}'\n      resolution: 1\n"),
      wantError: 'for_each_invalid_resolution',
      field: 'steps.a.for_each.resolution',
    },
    {
      name: 'for_each items',
      src: step('    for_each:\n      items: 5\n'),
      forbid: ['for_each_items_required'],
    },
    {
      name: 'loop sub-step ids and next target',
      src:
        `${head}steps:\n  a:\n    loop:\n      while: '{{ true }}'\n      max_iterations: 3\n      steps:\n` +
        '        - id: 3\n          executor: mock://x/y\n          next: {default: 4}\n' +
        `        - id: 4\n          executor: mock://x/z\n${tail}`,
      forbid: ['loop_step_id_required', 'invalid_type', 'loop_substep_next_target_not_found'],
    },
    {
      name: 'query parameter type is an unknown type, not a missing one',
      src: `${head}query:\n  q:\n    type: 1\nsteps:\n  a:\n    executor: mock://x/y\n${tail}`,
      forbid: ['query_param_type_missing'],
    },
    {
      name: 'query property type',
      src: `${head}query:\n  q:\n    type: object\n    properties:\n      inner:\n        type: 1\nsteps:\n  a:\n    executor: mock://x/y\n${tail}`,
      forbid: ['property_type_missing'],
    },
    {
      name: 'query array items type',
      src: `${head}query:\n  q:\n    type: array\n    items:\n      type: 1\nsteps:\n  a:\n    executor: mock://x/y\n${tail}`,
      wantError: 'array_items_type_invalid',
      field: 'query.q.items.type',
    },
    {
      name: 'credential inject_as',
      src: step(
        '    credentials:\n      k:\n        source: stored/openai/key\n        inject_as: 5\n',
      ),
      forbid: ['cred_bind_inject_as_empty'],
    },
    {
      name: 'expression function name is looked up, not called empty',
      src: `${head}expression_functions:\n  - function: 5\nsteps:\n  a:\n    executor: mock://x/y\n${tail}`,
      wantError: 'expression_function_unknown',
      field: 'expression_functions[0].function',
    },
    {
      name: 'a timestamp step reference',
      src: `${head}steps:\n  a:\n    executor: mock://x/y\n    next: {default: 2024-01-01}\n  2024-01-01:\n    executor: mock://x/y\n${tail}`,
      forbid: ['step_not_found'],
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const r = validateFlow(c.src);
      if (c.wantError === undefined) {
        expect(r.errors, JSON.stringify(r.errors)).toEqual([]);
      } else {
        expect(
          r.errors.filter((e) => e.code === c.wantError).map((e) => e.field),
          JSON.stringify(r.errors),
        ).toContain(c.field);
      }
      for (const code of c.forbid ?? []) expect(codes(r)).not.toContain(code);
      if (c.unreachable !== true) {
        expect(r.warnings.map((w) => w.code)).not.toContain('unreachable_step');
      }
    });
  }

  it('a numeric executor is the URL "42", refused as a URL', () => {
    const r = validateFlow(`${head}steps:\n  a:\n    executor: 42\n`);
    expect(r.errors.map((e) => [e.code, e.field])).toContainEqual([
      'invalid_executor_url',
      'steps.a.executor',
    ]);
    expect(codes(r)).not.toContain('invalid_type');
    expect(codes(r)).not.toContain('missing_required_field');
  });

  it('a list executor does not decode into a string', () => {
    const r = validateFlow(`${head}steps:\n  a:\n    executor: [x]\n`);
    expect(r.errors.map((e) => [e.code, e.field])).toContainEqual([
      'invalid_type',
      'steps.a.executor',
    ]);
  });
});

describe('a decoded object has no source text (PARITY.md divergence #13)', () => {
  // Without source text a number is rendered by its value — the same rendering
  // JavaScript gives a numeric object key — so an ordinary `2` still matches
  // the step `2`.
  const flow = (target: unknown): unknown => ({
    aigentflow_version: '2.0.0',
    name: 'p',
    start: 'a',
    steps: {
      a: { executor: 'mock://x/y', next: { default: target } },
      2: { executor: 'mock://x/y', next: { default: 'null' } },
    },
  });

  it('2 reaches the step 2', () => {
    const r = validateFlowObject(flow(2));
    expect(r.valid).toBe(true);
    expect(r.warnings.map((w) => w.code)).not.toContain('unreachable_step');
  });

  it('3 names no step', () => {
    const r = validateFlowObject(flow(3));
    expect(r.errors.map((e) => [e.code, e.field])).toContainEqual([
      'step_not_found',
      'steps.a.next.default',
    ]);
  });
});
