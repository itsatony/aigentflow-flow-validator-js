// Go's %q, byte for byte (strconv.Quote). The expected values were produced by Go
// itself (strconv.Quote, checked equal to fmt.Sprintf("%q")); flow_data_key_reserved
// and unknown_function_operation quote with it, as the reference does.

import { describe, expect, it } from 'vitest';
import { validateFlow } from '../src/index.js';
import { goQuote } from '../src/validators/util.js';

const CASES: [string, string][] = [
  ['a"b', '"a\\"b"'],
  ['\u00e9', '"\u00e9"'],
  ['\u0007', '"\\a"'],
  ['\u0001', '"\\x01"'],
  ['\u007f', '"\\x7f"'],
  ['\u00a0', '"\\u00a0"'],
  ['\u00ad', '"\\u00ad"'],
  ['\ud83d\ude00', '"\ud83d\ude00"'],
  ['\u2028', '"\\u2028"'],
  ['\udb40\udc01', '"\\U000e0001"'],
  ['\t', '"\\t"'],
  ['back\\slash', '"back\\\\slash"'],
  ['\u00e4 x', '"\u00e4 x"'],
  ['_memory', '"_memory"'],
  ['\u0301', '"\u0301"'],
  ['\u200b', '"\\u200b"'],
  ['\ufeff', '"\\ufeff"'],
];

describe('goQuote', () => {
  it.each(CASES)('%j', (input, want) => {
    expect(goQuote(input)).toBe(want);
  });
  it('writes a lone surrogate as U+FFFD', () => {
    expect(goQuote('\ud800')).toBe('"\ufffd"');
  });
});

describe('the two rules quote as %q', () => {
  it('flow_data_key_reserved: a reserved key holding a quote and a non-printable', () => {
    const yaml = [
      "aigentflow_version: '2.0.0'",
      'name: t',
      "version: '1.0.0'",
      'data:',
      '  "_a\\"b\\u00a0é": 1',
      'start: a',
      'steps:',
      '  a:',
      '    executor: mock://api/a',
      '    next:',
      "      default: 'null'",
      '',
    ].join('\n');
    const e = validateFlow(yaml).errors.find((x) => x.code === 'flow_data_key_reserved');
    expect(e?.message.startsWith('data: key "_a\\"b\\u00a0é" is reserved: ')).toBe(true);
  });
  it('unknown_function_operation: a step id holding a quote', () => {
    const yaml = [
      "aigentflow_version: '2.0.0'",
      'name: t',
      "version: '1.0.0'",
      "start: 'a\"é'",
      'steps:',
      "  'a\"é':",
      '    executor: function://nope/nothing',
      '    next:',
      "      default: 'null'",
      '',
    ].join('\n');
    const e = validateFlow(yaml).errors.find((x) => x.code === 'unknown_function_operation');
    expect(e?.message.startsWith('step "a\\"é" uses function://nope/nothing, ')).toBe(true);
  });
});
