import { describe, expect, it } from 'vitest';
import { pipedDefaultPipelines } from '../src/template/gotmpl-default.js';
import { validateFlow } from '../src/index.js';

const REFUSED = [
  'Hello, {{ .query.name | default "world" }}!',
  '{{ .query.n | default 10 }}',
  '{{ .query.name | default "w" | upper }}',
  '{{ (.query.name | default "w") }}',
  '{{ if .query.a }}{{ .query.b | default "x" }}{{ end }}',
  '{{ range .query.items }}{{ . | default "x" }}{{ end }}',
  '{{ with .query.a }}{{ . | default "x" }}{{ end }}',
  '{{ define "d" }}{{ .x | default "w" }}{{ end }}{{ template "d" . }}',
  '{{ $v := .query.a | default "w" }}{{ $v }}',
  '{{ upper (.query.a | default "w") }}',
  '{{ if .a | default "x" }}y{{ end }}',
  '{{ else if .a | default "x" }}',
  '{{- .a | default "x" -}}',
  '{{ template "t" .a | default "x" }}',
];

const CLEAN = [
  '{{ default .query.name "world" }}',
  '{{ atoi (default .query.n "0") }}',
  '{{ .query.name | upper }}',
  '{{ .query.default }}',
  '{{ .query.default | upper }}',
  '{{ index .query "default" }}',
  'literal text: | default "w"',
  '{{ "x | default y" }}',
  '{{ `x | default y` }}',
  '{{ $default := "w" }}{{ $default | upper }}',
  '{{ default (.query.a | upper) "w" }}',
  '{{ default .a "w" | upper }}',
  '{{/* .x | default "w" */}}done',
  '{{ .query.name | printf "%s" }}',
  '{{ .a | printf "| default %s" }}',
  '{{ $default | upper }}',
];

describe('pipedDefaultPipelines', () => {
  for (const t of REFUSED) {
    it(`flags ${t}`, () => {
      expect(pipedDefaultPipelines(t).length).toBeGreaterThan(0);
    });
  }
  for (const t of CLEAN) {
    it(`does not flag ${t}`, () => {
      expect(pipedDefaultPipelines(t)).toEqual([]);
    });
  }
  it('prints the pipeline the way the message names it', () => {
    expect(pipedDefaultPipelines('{{ .query.name  |  default "w" }}')).toEqual([
      '.query.name | default "w"',
    ]);
    expect(pipedDefaultPipelines('{{ $v := .a | default "w" }}')).toEqual([
      '$v := .a | default "w"',
    ]);
  });
});

function flowWith(message: string, loop = false): string {
  if (loop) {
    return `aigentflow_version: '2.0.0'
name: t
version: '1.0.0'
start: l
steps:
  l:
    loop:
      while: 'true'
      max_iterations: 2
      steps:
        - id: b
          executor: function://text/template
          query:
            m: '${message}'
    next:
      default: 'null'
`;
  }
  return `aigentflow_version: '2.0.0'
name: t
version: '1.0.0'
start: s
steps:
  s:
    executor: function://text/template
    query:
      m: '${message}'
    next:
      default: 'null'
`;
}

describe('template_default_piped severity and text', () => {
  const piped = `{{ .x | default "w" }}`;
  it('is an error at the top level, with the reference message', () => {
    const r = validateFlow(flowWith(piped));
    expect(r.valid).toBe(false);
    const e = r.errors.find((x) => x.code === 'template_default_piped');
    expect(e?.field).toBe('steps.s.query.m');
    expect(e?.message).toBe(
      '`default` takes the value FIRST, and a pipe passes the piped value LAST: `.x | default "w"` is `default <fallback> <value>`, so the fallback is always the result',
    );
    expect(e?.suggestion).toBe(
      'write the value first and the fallback second, as a call: `{{ default .x "fallback" }}`',
    );
  });
  it('is a warning in a loop body', () => {
    const r = validateFlow(flowWith(piped, true));
    expect(r.valid).toBe(true);
    expect(r.warnings.some((x) => x.code === 'template_default_piped')).toBe(true);
  });
  it('stays silent when the template does not parse', () => {
    const r = validateFlow(flowWith('{{ .x | default "w" '));
    expect([...r.errors, ...r.warnings].map((x) => x.code)).not.toContain('template_default_piped');
  });
});

describe('strict_templates', () => {
  const doc = (v: string): string =>
    flowWith('hi').replace('start: s', `strict_templates: ${v}\nstart: s`);
  it('accepts a boolean', () => {
    expect(validateFlow(doc('true')).valid).toBe(true);
    expect(validateFlow(doc('false')).valid).toBe(true);
  });
  it('rejects a non-boolean', () => {
    const r = validateFlow(doc('maybe'));
    expect(r.errors.map((e) => e.code)).toContain('invalid_type');
    expect(validateFlow(doc('5')).valid).toBe(false);
  });
});

describe('template_default_piped: hostile nesting', () => {
  it('does not overflow the stack on thousands of open parentheses', () => {
    const hostile = `{{ ${'('.repeat(50_000)}.x | default "w"${')'.repeat(50_000)} }}`;
    expect(() => pipedDefaultPipelines(hostile)).not.toThrow();
  });
  it('still flags a pipeline within the nesting bound', () => {
    expect(
      pipedDefaultPipelines(`{{ ${'('.repeat(10)}.x | default "w"${')'.repeat(10)} }}`).length,
    ).toBeGreaterThan(0);
  });
});
