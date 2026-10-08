// 0.16.0: AIgentFlow v2.811.0's untrusted-input marker. The keys are
// grammar only here; what they do at run time (sealing, fencing, taint) is
// engine behaviour and out of scope for static validation.

import { describe, expect, it } from 'vitest';
import { validateFlow } from '../src/index.js';

const unknownKeyFields = (yaml: string): string[] =>
  validateFlow(yaml)
    .errors.filter((e) => e.code === 'unknown_yaml_key')
    .map((e) => e.field ?? '');

describe('untrusted-input keys', () => {
  it('accepts untrusted on a query parameter and an input_schema field', () => {
    const yaml = `aigentflow_version: "2.0.0"
name: t
version: 1.0.0
start: only
query:
  trigger:
    type: object
    untrusted: true
input_schema:
  version: 1
  fields:
    - name: body
      type: multiline
      untrusted: true
steps:
  only:
    executor: function://text/noop
`;
    expect(unknownKeyFields(yaml)).toEqual([]);
  });

  it('accepts trusted_output and allow_untrusted on a step and a loop sub-step', () => {
    const yaml = `aigentflow_version: "2.0.0"
name: t
version: 1.0.0
start: only
steps:
  only:
    executor: http://request/json
    trusted_output: true
    allow_untrusted: [url, headers]
    loop:
      max_iterations: 2
      steps:
        - id: sub
          executor: http://request/json
          trusted_output: true
          allow_untrusted: [url]
`;
    expect(unknownKeyFields(yaml)).toEqual([]);
  });

  it('still refuses a misspelling', () => {
    const yaml = `aigentflow_version: "2.0.0"
name: t
version: 1.0.0
start: only
steps:
  only:
    executor: function://text/noop
    allow_untrusts: [url]
`;
    expect(unknownKeyFields(yaml).length).toBeGreaterThan(0);
  });
});
