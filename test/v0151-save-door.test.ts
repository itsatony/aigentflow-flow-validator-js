// 0.15.1: server_owned_query_key (AIgentFlow CFX-05), ported together with the
// Go port (go-aigentflow-validator v0.6.1). The conformance fixtures pin the
// verdict per key and per surface; these pin what a verdict cannot show — the
// exact field path, the step a finding names, one finding per key.

import { describe, expect, it } from 'vitest';
import { validateFlow, type ValidationResult } from '../src/index.js';
import { SERVER_OWNED_QUERY_KEYS } from '../src/spec/index.js';

const CODE = 'server_owned_query_key';

const MINIMAL = `aigentflow_version: "2.0.0"
name: test-flow
version: 1.0.0
start: only
steps:
  only:
    executor: function://text/noop
`;

const loopFlow = (subSteps: string): string => `aigentflow_version: "2.0.0"
name: test-flow
version: 1.0.0
start: only
steps:
  only:
    loop:
      while: '{{ lt .loop.index 2 }}'
      max_iterations: 2
      steps:
${subSteps}`;

const findings = (r: ValidationResult): { field: string; stepId?: string }[] =>
  r.errors.filter((e) => e.code === CODE).map((e) => ({ field: e.field, stepId: e.stepId }));

describe('server_owned_query_key', () => {
  it('the key set is the spec data (a new key is a spec change)', () => {
    expect([...SERVER_OWNED_QUERY_KEYS.keys].sort()).toEqual([
      'aiv_api_key',
      'aiv_base_url',
      'aiv_delegation',
    ]);
  });

  it('reports every key on a step, one finding each, in key order', () => {
    const r = validateFlow(
      `${MINIMAL}    query:\n      aiv_delegation: {user_id: x}\n      aiv_base_url: https://h.example\n      aiv_api_key: k\n      aiv_ref: fine\n`,
    );
    expect(findings(r)).toEqual([
      { field: 'steps.only.query.aiv_api_key', stepId: 'only' },
      { field: 'steps.only.query.aiv_base_url', stepId: 'only' },
      { field: 'steps.only.query.aiv_delegation', stepId: 'only' },
    ]);
  });

  it('refuses a declared key whose value is null', () => {
    const r = validateFlow(`${MINIMAL}    query:\n      aiv_base_url:\n`);
    expect(findings(r)).toEqual([{ field: 'steps.only.query.aiv_base_url', stepId: 'only' }]);
  });

  it('addresses a loop sub-step by its id and names the loop step', () => {
    const r = validateFlow(
      loopFlow(
        '        - id: fetch\n          executor: function://text/noop\n          query:\n            aiv_api_key: k\n',
      ),
    );
    expect(findings(r)).toEqual([
      { field: 'steps.only.loop.steps.fetch.query.aiv_api_key', stepId: 'only' },
    ]);
  });

  it('reads a numeric sub-step id by its source text', () => {
    const r = validateFlow(
      loopFlow(
        '        - id: 07\n          executor: function://text/noop\n          query:\n            aiv_delegation: x\n',
      ),
    );
    expect(findings(r)).toEqual([
      { field: 'steps.only.loop.steps.07.query.aiv_delegation', stepId: 'only' },
    ]);
  });

  it('addresses a sub-step without an id by the empty string (the reference refuses it at parse)', () => {
    const r = validateFlow(
      loopFlow(
        '        - executor: function://text/noop\n          query:\n            aiv_base_url: https://h.example\n',
      ),
    );
    expect(findings(r)).toEqual([
      { field: 'steps.only.loop.steps..query.aiv_base_url', stepId: 'only' },
    ]);
  });

  it('does not refuse another case, a nested key, or the name as a value', () => {
    const r = validateFlow(
      `${MINIMAL}    query:\n      AIV_API_KEY: a\n      Aiv_Base_Url: b\n      opts: {aiv_delegation: c}\n      ref: aiv_api_key\n`,
    );
    expect(findings(r)).toEqual([]);
  });
});
