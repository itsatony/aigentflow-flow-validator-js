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
 * Parse a Go `time.ParseDuration` string. Returns the duration in nanoseconds
 * or null when the string is not a valid Go duration.
 *
 * Go accepts a signed sequence of decimal numbers each with an optional
 * fraction and a unit suffix: "ns", "us"/"µs"/"μs", "ms", "s", "m", "h".
 * A leading sign is allowed; "0" is valid without a unit.
 */
const GO_DURATION_UNITS: Record<string, number> = {
  ns: 1,
  us: 1e3,
  // U+00B5 MICRO SIGN and U+03BC GREEK SMALL LETTER MU both used by Go.
  µs: 1e3,
  μs: 1e3,
  ms: 1e6,
  s: 1e9,
  m: 6e10,
  h: 36e11,
};

export function parseGoDuration(input: string): number | null {
  let s = input;
  if (s === '') return null;
  let sign = 1;
  if (s[0] === '+' || s[0] === '-') {
    if (s[0] === '-') sign = -1;
    s = s.slice(1);
  }
  // Special case: "0" with no unit is valid.
  if (s === '0') return 0;
  if (s === '') return null;

  let total = 0;
  let matchedAny = false;
  const re = /^(\d*\.?\d+)(ns|us|µs|μs|ms|s|m|h)/;
  while (s.length > 0) {
    const m = re.exec(s);
    if (!m) return null;
    const value = Number(m[1]);
    const unit = m[2] as string;
    if (!Number.isFinite(value)) return null;
    total += value * (GO_DURATION_UNITS[unit] as number);
    s = s.slice(m[0].length);
    matchedAny = true;
  }
  return matchedAny ? sign * total : null;
}

export function isValidGoDuration(input: string): boolean {
  return parseGoDuration(input) !== null;
}
