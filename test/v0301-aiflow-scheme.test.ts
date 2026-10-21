// 0.30.1 — AIgentFlow v2.842.0: aiflow:// is a known executor scheme (the
// stored-flow alias). Mirrors the Go port's validate_v0201_test.go.

import { describe, expect, it } from 'vitest';
import { validateFlow } from '../src/index.js';
import { EXECUTOR_SCHEMES } from '../src/spec/index.js';

const flow = (executor: string): string =>
  `aigentflow_version: "2.0.0"\nname: t\nversion: "1.0.0"\nstart: a\nsteps:\n  a:\n    executor: "${executor}"\n    next:\n      default: null\n`;

describe('aiflow:// scheme', () => {
  it('is a known scheme and draws no scheme warning or URL error', () => {
    expect(EXECUTOR_SCHEMES.has('aiflow')).toBe(true);
    for (const exec of [
      'aiflow://vai/baeckerei-zettel',
      'aiflow://org_acme/translator/v3',
      'AIFLOW://vai/x',
    ]) {
      const r = validateFlow(flow(exec));
      expect(
        r.warnings.filter((w) => w.code === 'unknown_executor_scheme'),
        exec,
      ).toEqual([]);
      expect(
        r.errors.filter((e) => e.code === 'invalid_executor_url'),
        exec,
      ).toEqual([]);
    }
  });

  it('still refuses a one-segment alias', () => {
    const r = validateFlow(flow('aiflow://onlyone'));
    const found = r.errors.filter((e) => e.code === 'invalid_executor_url');
    expect(found).toHaveLength(1);
    expect(found[0]!.field).toBe('steps.a.executor');
  });

  it('a typo still warns and suggests aiflow', () => {
    const r = validateFlow(flow('aiflw://vai/x'));
    expect(
      r.warnings.some(
        (w) => w.code === 'unknown_executor_scheme' && w.message.includes("Did you mean 'aiflow'?"),
      ),
    ).toBe(true);
  });
});
