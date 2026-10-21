// 0.15.0: the save-door rules AIgentFlow added after v2.753.0, ported from the
// Go port (go-aigentflow-validator v0.6.0). The conformance fixtures pin each
// verdict; these tests pin what a verdict cannot show — fields and counts.

import { describe, expect, it } from 'vitest';
import { validateFlow, type ValidationResult } from '../src/index.js';
import { envReferenceName } from '../src/validators/executorConfigEnv.js';
import { EXECUTOR_CONFIG_ENV_SCOPES } from '../src/spec/index.js';

const MINIMAL = `aigentflow_version: "2.0.0"
name: test-flow
version: 1.0.0
start: only
steps:
  only:
    executor: function://utils/log
`;

const codes = (issues: ValidationResult['errors']): string[] => issues.map((i) => i.code);
const fieldsWith = (issues: ValidationResult['errors'], code: string): string[] =>
  issues
    .filter((i) => i.code === code)
    .map((i) => i.field)
    .sort();

describe('executor_config_env_scope', () => {
  const flow = (block: string): ValidationResult =>
    validateFlow(`${MINIMAL}executor_config:\n${block}`);
  const CODE = 'executor_config_env_scope';

  it('reports every violation on its own field', () => {
    const r = flow(`  openai:
    api_key: '\${AIGENTFLOW_ANTHROPIC_API_KEY}'
    base_url: '\${AIGENTFLOW_OPENAI_BASE_URL}'
    organization: '\${X}'
  db:
    extra:
      a: '\${AIGENTFLOW_OPENAI_API_KEY}'
      b: '\${AIGENTFLOW_DB_REDIS_CONNECTION_STRING}'
`);
    expect(fieldsWith(r.errors, CODE)).toEqual([
      'executor_config.db.extra.a',
      'executor_config.openai.api_key',
      'executor_config.openai.organization',
    ]);
  });

  it('names the permitted set in the message, and says when it is empty', () => {
    const r = flow(
      "  aiv:\n    api_key: '${AIGENTFLOW_OPENAI_API_KEY}'\n  openai:\n    api_key: '${X}'\n",
    );
    const aiv = r.errors.find((e) => e.field === 'executor_config.aiv.api_key');
    expect(aiv?.message).toContain('(none');
    const openai = r.errors.find((e) => e.field === 'executor_config.openai.api_key');
    expect(openai?.message).toContain('AIGENTFLOW_OPENAI_API_KEY, AIGENTFLOW_OPENAI_BASE_URL');
  });

  it('uses the reference scope table, not a prefix rule', () => {
    // A computed pair exists only for AI provider keys: a driver key such as
    // `device` gets its protocol's variable and nothing composed.
    expect(
      fieldsWith(flow("  device:\n    api_key: '${AIGENTFLOW_DEVICE_API_KEY}'\n").errors, CODE),
    ).toEqual(['executor_config.device.api_key']);
    expect(flow("  device:\n    api_key: '${AIGENTFLOW_SHELLY_AUTH_KEY}'\n").valid).toBe(true);
    expect(Object.keys(EXECUTOR_CONFIG_ENV_SCOPES.scopes).length).toBeGreaterThanOrEqual(30);
  });

  it('gives a key named like an Object.prototype member an empty scope', () => {
    const r = flow("  constructor:\n    api_key: '${AIGENTFLOW_OPENAI_API_KEY}'\n");
    expect(fieldsWith(r.errors, CODE)).toEqual(['executor_config.constructor.api_key']);
  });

  it('reads a Go string field by source text, and an extra value only when it is a string', () => {
    // A number in api_key is its text, which is never a reference; a number in
    // extra is not text at all to the reference.
    const r = flow('  openai:\n    api_key: 1e3\n    extra:\n      n: 5\n      b: true\n');
    expect(codes(r.errors)).not.toContain(CODE);
  });

  it('recognises a reference as exactly ${NAME}', () => {
    const table: Record<string, string | null> = {
      '${A}': 'A',
      '${A}${B}': 'A}${B',
      '${}': null,
      '${A': null,
      'x${A}': null,
      '': null,
      $: null,
      '${': null,
    };
    for (const [value, want] of Object.entries(table)) {
      expect(envReferenceName(value), value).toBe(want);
    }
  });
});

// 0.29.0 (AIgentFlow v2.838.0): the orchestrator, whose `.exons` document was
// the last one a flow could carry, is removed and its block refused whole. So no
// rule reads an `.exons` frontmatter any more: what used to be refused there is
// one `orchestrator_removed` and nothing else.
describe('the orchestrator .exons document is no longer judged', () => {
  it('reports only orchestrator_removed for a document the old rules refused', () => {
    const r = validateFlow(
      `${MINIMAL}orchestrator:\n  exons: |\n    ---\n    name: o\n    requirements:\n      resources:\n        - {ref: a, kind: toolset}\n    tools:\n      allow: []\n    ---\n    hi\n`,
    );
    expect(codes(r.errors)).toEqual(['orchestrator_removed']);
    expect(fieldsWith(r.errors, 'orchestrator_removed')).toEqual(['orchestrator']);
    expect(r.warnings).toEqual([]);
  });
});
