// 0.15.0: the save-door rules AIgentFlow added after v2.753.0, ported from the
// Go port (go-aigentflow-validator v0.6.0). The conformance fixtures pin each
// verdict; these tests pin what a verdict cannot show — fields, counts, the
// frontmatter extraction, and the decode rules of the three fields read.

import { describe, expect, it } from 'vitest';
import { validateFlow, type ValidationResult } from '../src/index.js';
import { envReferenceName } from '../src/validators/executorConfigEnv.js';
import { extractExonsFrontmatter } from '../src/validators/exons.js';
import { EXECUTOR_CONFIG_ENV_SCOPES } from '../src/spec/index.js';

const MINIMAL = `aigentflow_version: "2.0.0"
name: test-flow
version: 1.0.0
start: only
steps:
  only:
    executor: function://text/noop
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

describe('the exons frontmatter extraction', () => {
  // [source, frontmatter, hasFrontmatter, parse refusal]
  const table: Array<[string, string, string, boolean, boolean]> = [
    ['plain', '---\na: 1\n---\nbody', 'a: 1', true, false],
    ['crlf', '---\r\na: 1\r\n---\r\nbody', 'a: 1', true, false],
    ['bom and indent', '\uFEFF  \t---\na: 1\n---\n', 'a: 1', true, false],
    ['closing at end of input', '---\na: 1\n---', 'a: 1', true, false],
    ['empty', '---\n---\n', '', true, false],
    ['no frontmatter', 'hello\n---\na: 1\n---\n', '', false, false],
    ['a newline before the delimiter', '\n---\na: 1\n---\n', '', false, false],
    ['delimiter alone', '---', '', false, false],
    ['delimiter with text', '---x\na: 1\n---\n', '', false, false],
    ['closing needs a line of its own', '---\na: 1\n---x\n---\n', 'a: 1\n---x', true, false],
    ['unclosed', '---\na: 1\n', '', true, true],
    ['legacy config block', '{~exons.config~}{}{~/exons.config~}', '', false, true],
  ];
  for (const [name, src, fm, has, refused] of table) {
    it(name, () => {
      const got = extractExonsFrontmatter(src);
      expect(got.frontmatter).toBe(fm);
      expect(got.hasFrontmatter).toBe(has);
      expect(got.parseError !== null).toBe(refused);
    });
  }
});

// The orchestrator verdict per frontmatter shape, measured on the Go port
// v0.6.0 with its BUILT-IN reader (the parity target) and with go-exons (the
// reference's engine). The first fifteen shapes are the Go port's own
// engine-agreement matrix; the rest pin the decode rules of the three fields.
// `engineOnly` marks a shape where the engine refuses (a decode or parse failure
// only an engine can judge) and both ports accept — divergence #16. Every other
// shape gets the SAME verdict and codes from the engine.
describe('orchestrator frontmatter shapes (Go port v0.6.0 verdicts)', () => {
  const spec =
    'name: o\ndescription: d\ntype: agent\nexecution:\n  provider: anthropic\n  model: m\n';
  const body = '{~exons.message role="system"~}hi{~/exons.message~}';
  const head = 'name: o\ndescription: d\ntype: agent\n';
  const SHAPES: Record<string, string> = {
    plain: '---\n' + spec + '---\n' + body,
    crlf: '---\r\n' + spec.replaceAll('\n', '\r\n') + '---\r\n' + body,
    'bom and indent': '﻿ \t---\n' + spec + '---\n' + body,
    'closing at end of input': '---\n' + spec + '---',
    'empty frontmatter': '---\n---\n' + body,
    'blank frontmatter': '---\n  \n---\n' + body,
    'no frontmatter': body,
    'newline first': '\n---\n' + spec + '---\n' + body,
    'delimiter with text': '---x\n' + spec + '---\n' + body,
    'closing with text': '---\n' + spec + '---x\n' + body,
    unclosed: '---\n' + spec + body,
    'legacy config block': '{~exons.config~}{}{~/exons.config~}' + body,
    'no provider': '---\n' + head + '---\n' + body,
    resources:
      '---\n' + spec + 'requirements:\n  resources:\n    - {ref: a, kind: corpus}\n---\n' + body,
    'allow empty': '---\n' + spec + 'tools:\n  allow: []\n---\n' + body,
    // Beyond the Go matrix: the decode rules of the three fields.
    'numeric provider': '---\n' + head + 'execution:\n  provider: 5\n  model: m\n---\n' + body,
    'null provider': '---\n' + head + 'execution:\n  provider: ~\n  model: m\n---\n' + body,
    'null execution': '---\n' + head + 'execution: ~\n---\n' + body,
    'scalar execution': '---\n' + head + 'execution: anthropic\n---\n' + body,
    'allow is a scalar': '---\n' + spec + 'tools:\n  allow: aif_ask_human\n---\n' + body,
    'allow null': '---\n' + spec + 'tools:\n  allow: ~\n---\n' + body,
    'allow with a number': '---\n' + spec + 'tools:\n  allow: [7]\n---\n' + body,
    'resources null': '---\n' + spec + 'requirements:\n  resources: ~\n---\n' + body,
    'resources null entry': '---\n' + spec + 'requirements:\n  resources: [~]\n---\n' + body,
    'resources scalar entry': '---\n' + spec + 'requirements:\n  resources: [a]\n---\n' + body,
    'duplicate key': '---\n' + spec + 'name: again\n---\n' + body,
    'undeclared key of any shape': '---\n' + spec + 'extra: [1, {a: b}]\n---\n' + body,
    'tag in frontmatter':
      '---\n' + head + 'execution:\n  provider: \'{~exons.var name="p" /~}\'\n---\n' + body,
    'comment-only frontmatter': '---\n# nothing\n---\n' + body,
    'frontmatter is a scalar': '---\njust text\n---\n' + body,
    'frontmatter is a list': '---\n- a\n---\n' + body,
    'closing after CR only': '---\n' + spec + '---\rrest\n' + body,
    'lf open, crlf body': '---\n' + spec.replaceAll('\n', '\r\n') + '---\r\n' + body,
    'allow null element': '---\n' + spec + 'tools:\n  allow: [~, aif_ask_human]\n---\n' + body,
    'allow only a null element': '---\n' + spec + 'tools:\n  allow: [~]\n---\n' + body,
    'FEFF-only frontmatter': '---\n\uFEFF\n---\n' + body,
    'numeric-key execution': '---\n' + head + 'execution:\n  1: x\n  provider: p\n---\n' + body,
    'merge key': '---\n' + head + 'base: &b {provider: p}\nexecution:\n  <<: *b\n---\n' + body,
    'NEL-only frontmatter': '---\n\u0085\n---\n' + body,
  };
  const EXPECTED: Record<
    string,
    { valid: boolean; errors: string[]; warnings: string[]; engineOnly?: true }
  > = {
    plain: { valid: true, errors: [], warnings: [] },
    crlf: { valid: true, errors: [], warnings: [] },
    'bom and indent': { valid: true, errors: [], warnings: [] },
    'closing at end of input': { valid: true, errors: [], warnings: [] },
    'empty frontmatter': {
      valid: false,
      errors: ['orchestrator_exons_parse_failed'],
      warnings: [],
    },
    'blank frontmatter': {
      valid: false,
      errors: ['orchestrator_exons_parse_failed'],
      warnings: [],
    },
    'no frontmatter': { valid: false, errors: ['orchestrator_exons_parse_failed'], warnings: [] },
    'newline first': { valid: false, errors: ['orchestrator_exons_parse_failed'], warnings: [] },
    'delimiter with text': {
      valid: false,
      errors: ['orchestrator_exons_parse_failed'],
      warnings: [],
    },
    'closing with text': {
      valid: false,
      errors: ['orchestrator_exons_parse_failed'],
      warnings: [],
    },
    unclosed: { valid: false, errors: ['orchestrator_exons_parse_failed'], warnings: [] },
    'legacy config block': {
      valid: false,
      errors: ['orchestrator_exons_parse_failed'],
      warnings: [],
    },
    'no provider': { valid: false, errors: ['orchestrator_exons_no_provider'], warnings: [] },
    resources: { valid: false, errors: ['exons_resources_unhonoured'], warnings: [] },
    'allow empty': { valid: true, errors: [], warnings: ['orchestrator_tool_withheld'] },
    'numeric provider': { valid: true, errors: [], warnings: [] },
    'null provider': { valid: false, errors: ['orchestrator_exons_no_provider'], warnings: [] },
    'null execution': { valid: false, errors: ['orchestrator_exons_no_provider'], warnings: [] },
    'scalar execution': { valid: true, errors: [], warnings: [], engineOnly: true },
    'allow is a scalar': { valid: true, errors: [], warnings: [], engineOnly: true },
    'allow null': { valid: true, errors: [], warnings: [] },
    'allow with a number': { valid: true, errors: [], warnings: ['orchestrator_tool_withheld'] },
    'resources null': { valid: true, errors: [], warnings: [] },
    'resources null entry': { valid: true, errors: [], warnings: [] },
    'resources scalar entry': { valid: true, errors: [], warnings: [], engineOnly: true },
    'duplicate key': { valid: true, errors: [], warnings: [], engineOnly: true },
    'undeclared key of any shape': { valid: true, errors: [], warnings: [] },
    'tag in frontmatter': { valid: true, errors: [], warnings: [], engineOnly: true },
    'comment-only frontmatter': {
      valid: false,
      errors: ['orchestrator_exons_no_provider'],
      warnings: [],
    },
    'frontmatter is a scalar': { valid: true, errors: [], warnings: [], engineOnly: true },
    'frontmatter is a list': { valid: true, errors: [], warnings: [], engineOnly: true },
    'closing after CR only': { valid: true, errors: [], warnings: [] },
    'lf open, crlf body': { valid: true, errors: [], warnings: [] },
    'allow null element': { valid: true, errors: [], warnings: [] },
    'allow only a null element': {
      valid: true,
      errors: [],
      warnings: ['orchestrator_tool_withheld'],
    },
    'FEFF-only frontmatter': {
      valid: false,
      errors: ['orchestrator_exons_no_provider'],
      warnings: [],
    },
    'numeric-key execution': { valid: true, errors: [], warnings: [] },
    'merge key': { valid: true, errors: [], warnings: [] },
    'NEL-only frontmatter': {
      valid: false,
      errors: ['orchestrator_exons_parse_failed'],
      warnings: [],
    },
  };

  // A YAML double-quoted scalar; every non-ASCII character is escaped so the
  // document text is exactly the shape.
  const quote = (s: string): string =>
    JSON.stringify(s).replace(
      /[\u007f-\uffff]/g,
      (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
    );

  it('covers every shape, and both verdicts', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual(Object.keys(SHAPES).sort());
    const refused = Object.values(EXPECTED).filter((e) => !e.valid).length;
    expect(refused).toBeGreaterThan(0);
    expect(refused).toBeLessThan(Object.keys(EXPECTED).length);
  });

  for (const [name, doc] of Object.entries(SHAPES)) {
    it(name, () => {
      const src =
        "aigentflow_version: '2.0.0'\nname: f\nversion: '1.0.0'\nstart: s\nsteps:\n  s:\n" +
        '    executor: function://text/template\norchestrator:\n  agentic: true\n  exons: ' +
        quote(doc) +
        '\n';
      const r = validateFlow(src);
      const want = EXPECTED[name];
      expect(want, name).toBeDefined();
      expect({ valid: r.valid, errors: codes(r.errors), warnings: codes(r.warnings) }).toEqual({
        valid: want?.valid,
        errors: want?.errors,
        warnings: want?.warnings,
      });
    });
  }
});

describe('orchestrator exons rules', () => {
  const DOC =
    '---\nname: orch\ndescription: coordinates\ntype: agent\nexecution: {provider: anthropic, model: m}\n%s---\nhi\n';
  const indent = (s: string): string =>
    s
      .split('\n')
      .filter((l) => l !== '')
      .map((l) => `    ${l}\n`)
      .join('');
  const orchFlow = (frontmatterExtra: string, orchExtra = '', flowExtra = ''): string =>
    `${MINIMAL}${flowExtra}orchestrator:\n  agentic: true\n${orchExtra}  exons: |\n${indent(
      DOC.replace('%s', frontmatterExtra),
    )}`;

  it('reads provider and resources', () => {
    expect(validateFlow(orchFlow('')).valid).toBe(true);
    const res = validateFlow(
      orchFlow('requirements:\n  resources:\n    - {ref: a, kind: toolset}\n'),
    );
    expect(fieldsWith(res.errors, 'exons_resources_unhonoured')).toEqual(['orchestrator.exons']);
    const noProvider = orchFlow('').replace(
      'execution: {provider: anthropic, model: m}',
      'execution: {model: m}',
    );
    expect(fieldsWith(validateFlow(noProvider).errors, 'orchestrator_exons_no_provider')).toEqual([
      'orchestrator.exons',
    ]);
  });

  it('does not read a templated frontmatter', () => {
    // The engine EXECUTES a frontmatter with a tag in it before decoding it.
    const src = orchFlow('requirements: {resources: [{ref: a, kind: toolset}]}\n').replace(
      'provider: anthropic',
      `provider: '{~exons.var name="p" /~}'`,
    );
    const r = validateFlow(src);
    expect(codes(r.errors)).not.toContain('exons_resources_unhonoured');
    expect(codes(r.errors)).not.toContain('orchestrator_exons_no_provider');
  });

  it('warns once per withheld named tool, on orchestrator.exons', () => {
    // aif_step_start and aif_step_cancel are withheld; a lifecycle tool, a
    // signal tool (signals on by default) and an allowed tool are not.
    const r = validateFlow(
      orchFlow(
        'tools:\n  allow: [aif_ask_human]\n',
        '  tools: [aif_step_start, aif_step_cancel, aif_mission_complete, aif_signal_complete, aif_ask_human]\n',
      ),
    );
    expect(fieldsWith(r.warnings, 'orchestrator_tool_withheld')).toEqual([
      'orchestrator.exons',
      'orchestrator.exons',
    ]);
  });

  it('warns only about aif_ask_human for an empty allow with orchestrator.tools empty', () => {
    const r = validateFlow(orchFlow('tools:\n  allow: []\n'));
    expect(fieldsWith(r.warnings, 'orchestrator_tool_withheld')).toHaveLength(1);
  });

  it('treats a null campaign as no campaign', () => {
    const r = validateFlow(orchFlow('tools:\n  allow: [aif_ask_human]\n', '', 'campaign:\n'));
    expect(codes(r.warnings)).not.toContain('orchestrator_tool_withheld');
  });

  it('reads enable_signals only as a boolean', () => {
    const named = '  tools: [aif_signal_complete]\n';
    const allow = 'tools:\n  allow: [aif_ask_human]\n';
    const warns = (orchExtra: string): number =>
      validateFlow(orchFlow(allow, named + orchExtra)).warnings.filter(
        (w) => w.code === 'orchestrator_tool_withheld',
      ).length;
    expect(warns('')).toBe(0);
    expect(warns('  enable_signals: true\n')).toBe(0);
    expect(warns('  enable_signals: false\n')).toBe(1);
  });
});
