import { describe, expect, it } from 'vitest';
import { checkGoTemplateSyntax } from '../src/template/gotmpl-syntax.js';
import { TEMPLATE_FUNCTIONS } from '../src/spec/index.js';

const ok = (s: string) => expect(checkGoTemplateSyntax(s)).toHaveLength(0);
const bad = (s: string) => expect(checkGoTemplateSyntax(s).length).toBeGreaterThan(0);

describe('gotmpl syntax — valid templates', () => {
  it('accepts plain text with no actions', () => ok('hello world'));
  it('accepts a simple field reference', () => ok('{{ .query.name }}'));
  it('accepts balanced if/end', () => ok('{{ if .x }}yes{{ end }}'));
  it('accepts if/else/end', () => ok('{{ if .x }}a{{ else }}b{{ end }}'));
  it('accepts else if chains', () => ok('{{ if .x }}a{{ else if .y }}b{{ else }}c{{ end }}'));
  it('accepts nested range + with', () =>
    ok('{{ range .items }}{{ with .sub }}{{ .v }}{{ end }}{{ end }}'));
  it('accepts trim markers', () => ok('{{- .x -}}'));
  it('accepts comments', () => ok('{{/* a comment */}}'));
  it('accepts pipelines', () => ok('{{ .name | upper | trim }}'));
  it('accepts braces inside a string literal', () => ok('{{ printf "%s}}" .x }}'));
  it('treats stray }} in text as literal (not an error)', () => ok('a }} b'));
  it('accepts define/template/block', () =>
    ok('{{ define "x" }}hi{{ end }}{{ template "x" }}{{ block "y" . }}z{{ end }}'));
});

describe('gotmpl syntax — invalid templates', () => {
  it('rejects unclosed action delimiter', () => bad('{{ .x '));
  it('rejects missing end for if', () => bad('{{ if .x }}yes'));
  it('rejects unexpected end', () => bad('done {{ end }}'));
  it('rejects else outside a block', () => bad('{{ else }}'));
  it('rejects empty action', () => bad('{{   }}'));
  it('rejects unterminated string in action', () => bad('{{ printf "unterminated }}'));
  it('rejects unclosed comment', () => bad('{{/* never closed }}'));
});

describe('gotmpl syntax — opt-in function allow-list', () => {
  const opts = { knownFunctions: TEMPLATE_FUNCTIONS, strictFunctions: true };

  it('does not flag known functions', () => {
    expect(checkGoTemplateSyntax('{{ upper .name }}', opts)).toHaveLength(0);
  });
  it('flags an unknown command-position function', () => {
    const errs = checkGoTemplateSyntax('{{ bogusFunc .name }}', opts);
    expect(errs.some((e) => e.isFunctionError)).toBe(true);
  });
  it('does not flag fields, variables, or literals', () => {
    expect(checkGoTemplateSyntax('{{ .field }}', opts)).toHaveLength(0);
    expect(checkGoTemplateSyntax('{{ $var }}', opts)).toHaveLength(0);
    expect(checkGoTemplateSyntax('{{ "literal" }}', opts)).toHaveLength(0);
  });
  it('is silent about unknown functions when strictFunctions is off', () => {
    expect(checkGoTemplateSyntax('{{ bogusFunc .name }}')).toHaveLength(0);
  });
});
