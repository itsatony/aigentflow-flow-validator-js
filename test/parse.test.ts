import { describe, expect, it } from 'vitest';
import { parseFlow } from '../src/parse.js';

describe('parseFlow', () => {
  it('parses a valid mapping', () => {
    const { flow, parseErrors } = parseFlow('name: x\nstart: a\n');
    expect(parseErrors).toHaveLength(0);
    expect(flow).toEqual({ name: 'x', start: 'a' });
  });

  it('reports empty input', () => {
    const { parseErrors } = parseFlow('   ');
    expect(parseErrors[0]?.code).toBe('empty_document');
  });

  it('reports duplicate keys with a position', () => {
    const { parseErrors } = parseFlow('name: a\nname: b\n');
    expect(parseErrors.some((e) => e.code === 'duplicate_key')).toBe(true);
    expect(parseErrors[0]?.line).toBeGreaterThan(0);
  });

  it('reports a syntax error', () => {
    const { parseErrors, flow } = parseFlow('name: [unclosed\n');
    expect(parseErrors.length).toBeGreaterThan(0);
    expect(flow).toBeUndefined();
  });

  it('rejects a non-mapping root', () => {
    const { parseErrors } = parseFlow('- just\n- a list\n');
    expect(parseErrors[0]?.code).toBe('invalid_flow_root');
  });
});
