// The "did you mean" for an unknown key (AIgentFlow #322), ported from the
// reference's `closeKeys` (aigentflow.parser.keyhints.go) with its Go string
// semantics kept exactly, so this port and the Go port print the same hint:
//
// - the case fold is Go's `strings.ToLower` (simple case mapping, one code point
//   at a time), not JS `toLowerCase` (SpecialCasing turns U+0130 into two);
// - the distance is Levenshtein over CODE POINTS (Go `[]rune`), not UTF-16 units;
// - the threshold divides the guess's UTF-8 BYTE length (Go `len`), not its
//   `.length`.

import { KEY_ALIASES } from '../spec/index.js';
import { goToLower } from './goUrl.js';

/** The threshold is `max(MAX_DISTANCE_FLOOR, utf8Length(guess) / DISTANCE_DIVISOR)`. */
const MAX_DISTANCE_FLOOR = 2;
const DISTANCE_DIVISOR = 3;

const UTF8_ONE_BYTE_LIMIT = 0x80;
const UTF8_TWO_BYTE_LIMIT = 0x800;
const UTF8_THREE_BYTE_LIMIT = 0x10000;

/**
 * Go's `len(s)` for the UTF-8 encoding of `s`. A lone surrogate counts 3, the
 * size of the U+FFFD Go would hold in its place.
 */
function utf8Length(s: string): number {
  let n = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp < UTF8_ONE_BYTE_LIMIT) n += 1;
    else if (cp < UTF8_TWO_BYTE_LIMIT) n += 2;
    else if (cp < UTF8_THREE_BYTE_LIMIT) n += 3;
    else n += 4;
  }
  return n;
}

/** Levenshtein distance over code points (Go `[]rune`). */
export function runeEditDistance(a: string, b: string): number {
  const ra = Array.from(a);
  const rb = Array.from(b);
  let prev = Array.from({ length: rb.length + 1 }, (_, j) => j);
  for (let i = 1; i <= ra.length; i++) {
    const cur = [i];
    for (let j = 1; j <= rb.length; j++) {
      cur[j] = Math.min(
        prev[j]! + 1,
        cur[j - 1]! + 1,
        prev[j - 1]! + (ra[i - 1] === rb[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[rb.length]!;
}

/**
 * The accepted keys a guess may have meant: the alias table's targets first (in
 * table order, only those `accepted` declares), then every accepted key within
 * the edit-distance threshold, nearest first. Ties keep `accepted`'s order, so
 * callers pass the SORTED key list both ports print as "Known keys here".
 * Deduplicated; empty when nothing is close.
 */
export function closeKeys(guess: string, accepted: readonly string[]): string[] {
  const acceptedSet = new Set(accepted);
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (key: string): void => {
    if (acceptedSet.has(key) && !seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  };
  const lowerGuess = goToLower(guess);
  for (const alias of KEY_ALIASES.get(lowerGuess) ?? []) add(alias);
  const limit = Math.max(MAX_DISTANCE_FLOOR, Math.floor(utf8Length(guess) / DISTANCE_DIVISOR));
  const near: { key: string; distance: number }[] = [];
  for (const key of accepted) {
    const distance = runeEditDistance(lowerGuess, goToLower(key));
    if (distance <= limit) near.push({ key, distance });
  }
  // Array.prototype.sort is stable (ES2019), as Go's sort.SliceStable is.
  near.sort((x, y) => x.distance - y.distance);
  for (const n of near) add(n.key);
  return out;
}

/** ` Did you mean `a` or `b`?`, or '' when no accepted key is close. */
export function didYouMean(guess: string, accepted: readonly string[]): string {
  const close = closeKeys(guess, accepted);
  if (close.length === 0) return '';
  return ` Did you mean ${close.map((k) => `\`${k}\``).join(' or ')}?`;
}
