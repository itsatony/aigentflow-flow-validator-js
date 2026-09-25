// Shared helpers for the validator modules: an issue collector and a handful
// of defensive type guards. User YAML is arbitrary, so every validator treats
// the parsed document as `unknown` and narrows explicitly.

import type { ValidationIssue } from '../types.js';

/** Accumulates errors and warnings during a validation pass. */
export class Issues {
  readonly errors: ValidationIssue[] = [];
  readonly warnings: ValidationIssue[] = [];

  error(issue: Omit<ValidationIssue, 'severity'>): void {
    this.errors.push({ ...issue, severity: 'error' });
  }

  warn(issue: Omit<ValidationIssue, 'severity'>): void {
    this.warnings.push({ ...issue, severity: 'warning' });
  }
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function isString(v: unknown): v is string {
  return typeof v === 'string';
}

export function isArray(v: unknown): v is unknown[] {
  return Array.isArray(v);
}

/** A finite number (excludes NaN / Infinity), matching YAML numeric scalars. */
export function isNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function isInteger(v: unknown): v is number {
  return isNumber(v) && Number.isInteger(v);
}

/** Sorted list of step keys, used for "available steps" context messages. */
export function stepNames(steps: Record<string, unknown>): string[] {
  return Object.keys(steps).sort();
}

/**
 * The text a Go `string` field receives for a YAML scalar, or null for a value
 * that is not a scalar. yaml.v3 decodes ANY scalar into a string field, so
 * `delay: 100` arrives as "100" and `tool_discovery: true` as "true"; a YAML
 * null decodes to "". The parsed document has lost the source spelling, so a
 * number is rendered the way JavaScript renders it — which differs from the
 * source only for spellings such as `0.0`, `00` or `0x0` (see PARITY.md).
 */
export function scalarText(v: unknown): string | null {
  if (v === null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return null;
}

/**
 * Parse a Go `time.ParseDuration` string. Returns the duration in nanoseconds
 * or null when the string is not a valid Go duration.
 *
 * A line-for-line port of Go's `time.ParseDuration` (`time/format.go`),
 * including its integer overflow rules, so the verdict is exact rather than
 * approximate at the int64 boundary: an optional sign, then one or more
 * `[0-9]*(\.[0-9]*)?<unit>` groups with digits on at least one side of the
 * point, units "ns", "us"/"µs"/"μs", "ms", "s", "m", "h". A bare "0" (after
 * the sign) needs no unit. The unit is the longest run of characters that are
 * not a digit or ".", so "5m " has the unknown unit "m ".
 */
const GO_DURATION_UNITS: Record<string, bigint> = {
  ns: 1n,
  us: 1_000n,
  // U+00B5 MICRO SIGN and U+03BC GREEK SMALL LETTER MU are both accepted by Go.
  µs: 1_000n,
  μs: 1_000n,
  ms: 1_000_000n,
  s: 1_000_000_000n,
  m: 60_000_000_000n,
  h: 3_600_000_000_000n,
};

/** 1<<63: Go's time.Duration is an int64. */
const GO_INT64_LIMIT = 1n << 63n;
const GO_INT64_MAX = GO_INT64_LIMIT - 1n;

function isDigit(c: string | undefined): boolean {
  return c !== undefined && c >= '0' && c <= '9';
}

/** Go's leadingInt: consume [0-9]*, or null on overflow past 1<<63. */
function leadingInt(s: string): { x: bigint; rest: string } | null {
  let x = 0n;
  let i = 0;
  for (; i < s.length && isDigit(s[i]); i++) {
    if (x > GO_INT64_LIMIT / 10n) return null;
    x = x * 10n + BigInt(s.charCodeAt(i) - 48);
    if (x > GO_INT64_LIMIT) return null;
  }
  return { x, rest: s.slice(i) };
}

/** Go's leadingFraction: consume [0-9]*, silently dropping digits past overflow. */
function leadingFraction(s: string): { x: bigint; scale: number; rest: string } {
  let x = 0n;
  let scale = 1;
  let overflow = false;
  let i = 0;
  for (; i < s.length && isDigit(s[i]); i++) {
    if (overflow) continue;
    if (x > GO_INT64_MAX / 10n) {
      overflow = true;
      continue;
    }
    const y = x * 10n + BigInt(s.charCodeAt(i) - 48);
    if (y > GO_INT64_LIMIT) {
      overflow = true;
      continue;
    }
    x = y;
    scale *= 10;
  }
  return { x, scale, rest: s.slice(i) };
}

export function parseGoDuration(input: string): number | null {
  let s = input;
  let neg = false;
  if (s !== '' && (s[0] === '-' || s[0] === '+')) {
    neg = s[0] === '-';
    s = s.slice(1);
  }
  if (s === '0') return 0;
  if (s === '') return null;

  let d = 0n;
  while (s !== '') {
    // The next character must be [0-9.].
    if (!(s[0] === '.' || isDigit(s[0]))) return null;
    const before = s.length;
    const lead = leadingInt(s);
    if (lead === null) return null;
    let v = lead.x;
    s = lead.rest;
    const pre = before !== s.length;

    let f = 0n;
    let scale = 1;
    let post = false;
    if (s !== '' && s[0] === '.') {
      s = s.slice(1);
      const fracBefore = s.length;
      const frac = leadingFraction(s);
      f = frac.x;
      scale = frac.scale;
      s = frac.rest;
      post = fracBefore !== s.length;
    }
    if (!pre && !post) return null;

    let i = 0;
    while (i < s.length && !(s[i] === '.' || isDigit(s[i]))) i++;
    if (i === 0) return null; // missing unit
    const unit = GO_DURATION_UNITS[s.slice(0, i)];
    s = s.slice(i);
    if (unit === undefined) return null; // unknown unit

    if (v > GO_INT64_LIMIT / unit) return null;
    v *= unit;
    if (f > 0n) {
      // Go computes this term in float64 and truncates it; so does this.
      v += BigInt(Math.trunc(Number(f) * (Number(unit) / scale)));
      if (v > GO_INT64_LIMIT) return null;
    }
    d += v;
    if (d > GO_INT64_LIMIT) return null;
  }
  if (neg) return -Number(d);
  if (d > GO_INT64_MAX) return null;
  return Number(d);
}

export function isValidGoDuration(input: string): boolean {
  return parseGoDuration(input) !== null;
}
