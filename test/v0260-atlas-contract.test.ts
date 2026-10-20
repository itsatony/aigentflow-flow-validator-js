// 0.26.0: reserved_input_name, atlas_model_not_literal, atlas_param_refused, and
// the alignments of the atlas rules with the reference.

import { describe, expect, it } from 'vitest';
import { validateFlow } from '../src/index.js';

const flow = (executor: string, query = ''): string => `aigentflow_version: "2.0.0"
name: test-flow
version: 1.0.0
start: only
steps:
  only:
    executor: ${executor}
${query === '' ? '' : `    query:\n${query}`}`;

const inputFlow = (top: string): string => `aigentflow_version: "2.0.0"
name: test-flow
version: 1.0.0
${top}start: only
steps:
  only:
    executor: function://utils/log
`;

const codes = (y: string): string[] => validateFlow(y).errors.map((e) => e.code ?? '');

describe('reserved_input_name', () => {
  it('reports query names sorted, then schema fields in file order, with no step id', () => {
    const r = validateFlow(
      inputFlow(`query:
  zeta:
    type: string
  __b:
    type: string
  __a:
    type: string
input_schema:
  version: 1
  fields:
    - name: ok
      type: string
      label: Ok
    - name: __c
      type: string
      label: C
`),
    );
    const found = r.errors.filter((e) => e.code === 'reserved_input_name');
    expect(found.map((e) => e.field)).toEqual([
      'query.__a',
      'query.__b',
      'input_schema.fields.__c',
    ]);
    expect(found.every((e) => e.stepId === undefined)).toBe(true);
  });

  it('leaves a single leading underscore and an inner double underscore alone', () => {
    const r = validateFlow(
      inputFlow('query:\n  _x:\n    type: string\n  a__b:\n    type: string\n'),
    );
    expect(r.errors.filter((e) => e.code === 'reserved_input_name')).toEqual([]);
  });
});

describe('atlas rules aligned with the reference', () => {
  it('refuses a templated model, however deep', () => {
    const q =
      "      agent: '@a/b'\n      prompt: hi\n      model:\n        reasoning_effort: '{{ .query.e }}'\n";
    expect(codes(flow('atlas://agent/run', q))).toEqual(['atlas_model_not_literal']);
  });

  it('reports one sorted atlas_param_refused finding per step', () => {
    const q =
      "      agent: '@a/b'\n      prompt: hi\n      url: x\n      attribution: y\n      api_key: z\n";
    const r = validateFlow(flow('atlas://agent/run', q));
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]!.code).toBe('atlas_param_refused');
    expect(r.errors[0]!.field).toBe('steps.only');
    expect(r.errors[0]!.message).toBe(
      'step "only" sets api_key, attribution, url under query. Atlas decides these itself, so a step may not set them.',
    );
  });

  it('uses the smaller reserved set on a capability step', () => {
    expect(codes(flow('atlas://capability/web_fetch', '      url: x\n      host: y\n'))).toEqual(
      [],
    );
    const r = validateFlow(
      flow(
        'atlas://capability/web_fetch',
        '      untrusted_input_override: true\n      attribution: a\n',
      ),
    );
    expect(r.errors[0]!.message).toBe(
      'step "only" sets attribution, untrusted_input_override under query. Atlas decides these itself, so a step may not set them.',
    );
  });

  it('counts presence after trimming, and a non-string agent as missing', () => {
    expect(codes(flow('atlas://agent/run', '      agent: 42\n      prompt: hi\n'))).toEqual([
      'atlas_agent_missing',
    ]);
    expect(codes(flow('atlas://agent/run', "      agent: '  '\n      prompt: hi\n"))).toEqual([
      'atlas_agent_missing',
    ]);
    expect(codes(flow('atlas://agent/run', "      agent: '@a/b'\n      prompt: '  '\n"))).toEqual([
      'atlas_prompt_missing',
    ]);
    expect(
      codes(
        flow(
          'atlas://agent/run',
          "      agent: '@a/b'\n      prompt: ''\n      prompt_template: x\n",
        ),
      ),
    ).toEqual([]);
  });

  it('checks capabilities deeply and on a capability step too', () => {
    const q = "      capabilities:\n        - a: '{{ .x }}'\n";
    expect(codes(flow('atlas://capability/calc', q))).toEqual(['atlas_capabilities_not_literal']);
  });

  it('keeps a dot or colon out of a capability reference', () => {
    for (const ref of ['a.b', 'a:b']) {
      expect(codes(flow(`atlas://capability/${ref}`))).toContain('atlas_capability_ref_invalid');
    }
  });

  it('judges an atlas URL the shared URL shape refuses, and keeps the scheme match exact', () => {
    expect(
      codes(flow('atlas://agent/run/extra', "      agent: '@a/b'\n      prompt: hi\n")),
    ).toContain('atlas_operation_unknown');
    expect(codes(flow('ATLAS://agent/run'))).not.toContain('atlas_agent_missing');
  });
});
