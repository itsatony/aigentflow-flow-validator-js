// 0.36.0 (AIgentFlow 2.912.0): catalogue sub-flows (flow://aiv/<org>/<name>),
// partials (include://aiv/<org>/<name>) and the flow_version step key.

import { describe, expect, it } from 'vitest';
import { validateFlow } from '../src/index.js';

const flow = (executor: string, extra = ''): string => `aigentflow_version: "2.0.0"
name: test-flow
version: 1.0.0
start: only
steps:
  only:
    executor: '${executor}'
${extra}    next:
      default: 'null'
`;

const codes = (yaml: string): string[] => validateFlow(yaml).errors.map((e) => e.code);

describe('catalogue refs and flow_version (0.36.0)', () => {
  it('accepts a pinned and a floating catalogue sub-flow and a partial', () => {
    expect(codes(flow('flow://aiv/acme/summarise-doc', "    flow_version: '1.2.0'\n"))).toEqual([]);
    expect(codes(flow('flow://aiv/acme/summarise-doc'))).toEqual([]);
    expect(
      codes(flow('include://aiv/acme/review-text', "    flow_version: '0.3.0-rc.1'\n")),
    ).toEqual([]);
  });

  it('flow_version is not a key the save door drops: it is a known step key', () => {
    const result = validateFlow(flow('flow://aiv/acme/x', "    flow_version: '1.0.0'\n"));
    expect(result.errors.map((e) => e.code)).not.toContain('unknown_yaml_key');
    expect(result.warnings.map((w) => w.code)).not.toContain('unknown_yaml_key');
  });

  it('refuses a version that is not semver, with the reference text', () => {
    const result = validateFlow(flow('flow://aiv/acme/x', "    flow_version: '1.2'\n"));
    const issue = result.errors.find((e) => e.code === 'flow_version_invalid');
    expect(issue?.message).toBe(
      'step only: flow_version "1.2" is not a semver (MAJOR.MINOR.PATCH, e.g. 1.2.0)',
    );
    expect(issue?.field).toBe('steps.only.flow_version');
  });

  it('refuses flow_version anywhere but a catalogue step', () => {
    for (const executor of ['ai://openai/chat', 'flow://stored/flw_abc123', 'aiv://acme/agent']) {
      expect(codes(flow(executor, "    flow_version: '1.2.0'\n"))).toContain(
        'flow_version_not_catalog',
      );
    }
  });

  it('refuses a ref that is not exactly one org and one name', () => {
    for (const executor of ['flow://aiv/acme/a/b', 'include://aiv/acme', 'flow://aiv/-acme/x']) {
      const result = validateFlow(flow(executor));
      const issue = result.errors.find((e) => e.code === 'catalog_ref_invalid');
      expect(issue, executor).toBeDefined();
      expect(issue?.field).toBe('steps.only.executor');
    }
  });

  it('does not judge a templated catalogue URL', () => {
    expect(codes(flow('flow://aiv/{{ .query.org }}/x'))).not.toContain('catalog_ref_invalid');
  });

  it('knows the include scheme', () => {
    const result = validateFlow(flow('include://aiv/acme/review-text'));
    expect(result.warnings.map((w) => w.code)).not.toContain('unknown_executor_scheme');
    expect(result.errors.map((e) => e.code)).not.toContain('unknown_executor_scheme');
  });
});
