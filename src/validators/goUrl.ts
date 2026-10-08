// The origin reduction `credential_endpoint_unpaired` compares endpoints by,
// ported from the reference (`credentialEndpointOrigin`), which is Go's
// `net/url.Parse` (Go 1.25) plus `strings.TrimSpace` / `strings.ToLower`. The
// rule only ever asks "is this endpoint the family's DEFAULT origin?", so the
// port has to agree with Go on exactly two things: which strings Go refuses
// (a refused string is compared as text, and can never equal a default), and
// the scheme and host Go extracts from the rest.
//
// Not ported, verdict-neutral: Go validates a bracketed IPv6 literal with
// `netip.ParseAddr`. A bracketed host is never a default's host, parsed or
// refused, so the answer to the one question asked is the same.

/** Go's `unicode.IsSpace` set, which `strings.TrimSpace` trims (not JS `trim`: Go keeps U+FEFF and trims U+0085). */
const GO_SPACE =
  '\\t\\n\\v\\f\\r \\u0085\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000';
const GO_TRIM_SPACE_RE = new RegExp(`^[${GO_SPACE}]+|[${GO_SPACE}]+$`, 'g');

/** Go's `strings.TrimSpace`. */
export function goTrimSpace(s: string): string {
  return s.replace(GO_TRIM_SPACE_RE, '');
}

/**
 * Go's `strings.ToLower`: SIMPLE case mapping, one code point at a time. JS
 * `toLowerCase` applies SpecialCasing, which turns U+0130 into two code points
 * (Go: `i`) and a final sigma into U+03C2 (Go: U+03C3).
 */
export function goToLower(s: string): string {
  let out = '';
  for (const ch of s) {
    out += ch === '\u0130' ? 'i' : ch.toLowerCase();
  }
  return out;
}

/** Go's `encoding` modes, the ones `parse` uses. */
const Mode = {
  Path: 1,
  Host: 2,
  Zone: 3,
  UserPassword: 4,
  Fragment: 5,
} as const;
type EncodeMode = (typeof Mode)[keyof typeof Mode];

function isAlnum(c: number): boolean {
  return (c >= 0x61 && c <= 0x7a) || (c >= 0x41 && c <= 0x5a) || (c >= 0x30 && c <= 0x39);
}

function isHex(c: number | undefined): boolean {
  return (
    c !== undefined &&
    ((c >= 0x30 && c <= 0x39) || (c >= 0x61 && c <= 0x66) || (c >= 0x41 && c <= 0x46))
  );
}

function unhex(c: number): number {
  if (c >= 0x30 && c <= 0x39) return c - 0x30;
  if (c >= 0x61 && c <= 0x66) return c - 0x61 + 10;
  return c - 0x41 + 10;
}

/** Go's `shouldEscape` for the modes `parse` uses. */
function shouldEscape(c: number, mode: EncodeMode): boolean {
  if (isAlnum(c)) return false;
  const ch = String.fromCharCode(c);
  if ((mode === Mode.Host || mode === Mode.Zone) && `!$&'()*+,;=:[]<>"`.includes(ch)) return false;
  if ('-_.~'.includes(ch)) return false;
  if ('$&+,/:;=?@'.includes(ch)) {
    switch (mode) {
      case Mode.Path:
        return ch === '?';
      case Mode.UserPassword:
        return ch === '@' || ch === '/' || ch === '?' || ch === ':';
      case Mode.Fragment:
        return false;
      default:
        break;
    }
  }
  if (mode === Mode.Fragment && '!()*'.includes(ch)) return false;
  return true;
}

/** Go's `unescape` over UTF-8 bytes: the decoded bytes, or null where Go returns an error. */
function unescape(s: Uint8Array, mode: EncodeMode): Uint8Array | null {
  const out: number[] = [];
  for (let i = 0; i < s.length; ) {
    const c = s[i] as number;
    if (c === 0x25 /* % */) {
      const h1 = s[i + 1];
      const h2 = s[i + 2];
      if (i + 2 >= s.length || !isHex(h1) || !isHex(h2)) return null;
      const hi = unhex(h1 as number);
      const lo = unhex(h2 as number);
      const isPct25 = hi === 2 && lo === 5;
      if (mode === Mode.Host && hi < 8 && !isPct25) return null;
      if (mode === Mode.Zone) {
        const v = (hi << 4) | lo;
        if (!isPct25 && v !== 0x20 && shouldEscape(v, Mode.Host)) return null;
      }
      out.push((hi << 4) | lo);
      i += 3;
      continue;
    }
    if ((mode === Mode.Host || mode === Mode.Zone) && c < 0x80 && shouldEscape(c, mode)) {
      return null;
    }
    out.push(c);
    i++;
  }
  return Uint8Array.from(out);
}

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder('utf-8');

function unescapeText(s: string, mode: EncodeMode): string | null {
  const bytes = unescape(utf8Encoder.encode(s), mode);
  return bytes === null ? null : utf8Decoder.decode(bytes);
}

/** Go's `validOptionalPort`: "" or `:` followed by digits only. */
function validOptionalPort(port: string): boolean {
  if (port === '') return true;
  if (port[0] !== ':') return false;
  return /^[0-9]*$/.test(port.slice(1));
}

/** Go's `validUserinfo`. */
function validUserinfo(s: string): boolean {
  for (const ch of s) {
    const c = ch.codePointAt(0) as number;
    if (c < 0x80 && isAlnum(c)) continue;
    if (`-._:~!$&'()*+,;=%@`.includes(ch)) continue;
    return false;
  }
  return true;
}

/** Go's `parseHost`: the unescaped host (with port), or null on error. */
function parseHost(host: string): string | null {
  const open = host.lastIndexOf('[');
  if (open !== -1) {
    const close = host.lastIndexOf(']');
    if (close < 0) return null;
    const colonPort = host.slice(close + 1);
    if (!validOptionalPort(colonPort)) return null;
    const port = unescapeText(colonPort, Mode.Host);
    if (port === null) return null;
    const hostname = host.slice(open + 1, close);
    const zone = hostname.indexOf('%25');
    let name: string | null;
    if (zone >= 0) {
      const hostPart = unescapeText(hostname.slice(0, zone), Mode.Host);
      const zonePart = unescapeText(hostname.slice(zone), Mode.Zone);
      name = hostPart === null || zonePart === null ? null : hostPart + zonePart;
    } else {
      name = unescapeText(hostname, Mode.Host);
    }
    if (name === null) return null;
    return `[${name}]${port}`;
  }
  const colon = host.lastIndexOf(':');
  if (colon !== -1 && !validOptionalPort(host.slice(colon))) return null;
  return unescapeText(host, Mode.Host);
}

/** Go's `parseAuthority`: the host, and whether the authority carries userinfo (`u.User != nil`). */
function parseAuthority(authority: string): { host: string; hasUser: boolean } | null {
  const at = authority.lastIndexOf('@');
  const host = parseHost(at < 0 ? authority : authority.slice(at + 1));
  if (host === null) return null;
  if (at < 0) return { host, hasUser: false };
  const userinfo = authority.slice(0, at);
  if (!validUserinfo(userinfo)) return null;
  const colon = userinfo.indexOf(':');
  const parts = colon < 0 ? [userinfo] : [userinfo.slice(0, colon), userinfo.slice(colon + 1)];
  for (const part of parts) {
    if (unescapeText(part, Mode.UserPassword) === null) return null;
  }
  return { host, hasUser: true };
}

/** Go's `getScheme`: null for "missing protocol scheme". */
function getScheme(raw: string): { scheme: string; rest: string } | null {
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    if ((c >= 0x61 && c <= 0x7a) || (c >= 0x41 && c <= 0x5a)) continue;
    if ((c >= 0x30 && c <= 0x39) || c === 0x2b || c === 0x2d || c === 0x2e) {
      if (i === 0) return { scheme: '', rest: raw };
      continue;
    }
    if (c === 0x3a /* : */) {
      if (i === 0) return null;
      return { scheme: raw.slice(0, i), rest: raw.slice(i + 1) };
    }
    return { scheme: '', rest: raw };
  }
  return { scheme: '', rest: raw };
}

function containsCTL(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

/** What {@link goParseURLParts} extracts from a URL Go accepts. */
export interface GoURLParts {
  scheme: string;
  /** `u.Host`: the host with its port, after any userinfo. */
  host: string;
  /** `u.User != nil`: an `@` in the authority, even an empty userinfo. */
  hasUser: boolean;
  /** `u.RawQuery`: the text after the first `?`. */
  rawQuery: string;
  /** `u.Fragment`, still escaped (callers judge only its emptiness). */
  fragment: string;
}

/**
 * Go's `url.Parse`, reduced to what it yields for `Scheme` and `Host`; null
 * where Go returns an error.
 */
export function goParseSchemeHost(rawURL: string): { scheme: string; host: string } | null {
  const u = goParseURLParts(rawURL);
  return u === null ? null : { scheme: u.scheme, host: u.host };
}

/**
 * Go's `url.Parse`, reduced to the parts the `examples:` file-reference rule
 * reads (scheme, host, userinfo presence, query, fragment); null where Go
 * returns an error.
 */
export function goParseURLParts(rawURL: string): GoURLParts | null {
  const hash = rawURL.indexOf('#');
  const main = hash < 0 ? rawURL : rawURL.slice(0, hash);
  const frag = hash < 0 ? '' : rawURL.slice(hash + 1);

  if (containsCTL(main)) return null;
  if (main === '*') {
    return { scheme: '', host: '', hasUser: false, rawQuery: '', fragment: frag };
  }
  const split = getScheme(main);
  if (split === null) return null;
  const scheme = split.scheme.toLowerCase(); // ASCII by construction
  let rest = split.rest;
  const questionMarks = rest.split('?').length - 1;
  let rawQuery = '';
  if (rest.endsWith('?') && questionMarks === 1) {
    rest = rest.slice(0, -1);
  } else if (questionMarks > 0) {
    rawQuery = rest.slice(rest.indexOf('?') + 1);
    rest = rest.slice(0, rest.indexOf('?'));
  }

  if (!rest.startsWith('/')) {
    if (scheme !== '') return finish({ scheme, host: '', hasUser: false, rawQuery }, frag); // opaque
    const slash = rest.indexOf('/');
    const segment = slash < 0 ? rest : rest.slice(0, slash);
    if (segment.includes(':')) return null;
  }

  let host = '';
  let hasUser = false;
  if ((scheme !== '' || !rest.startsWith('///')) && rest.startsWith('//')) {
    let authority = rest.slice(2);
    rest = '';
    const slash = authority.indexOf('/');
    if (slash >= 0) {
      rest = authority.slice(slash);
      authority = authority.slice(0, slash);
    }
    const parsed = parseAuthority(authority);
    if (parsed === null) return null;
    host = parsed.host;
    hasUser = parsed.hasUser;
  }
  if (unescapeText(rest, Mode.Path) === null) return null;
  return finish({ scheme, host, hasUser, rawQuery }, frag);
}

function finish(u: Omit<GoURLParts, 'fragment'>, frag: string): GoURLParts | null {
  if (frag !== '' && unescapeText(frag, Mode.Fragment) === null) return null;
  return { ...u, fragment: frag };
}

/**
 * The KEYS of Go's `url.Values` for a raw query (`u.Query()`): pairs split on
 * `&`, a pair containing `;` skipped, a key that does not unescape skipped,
 * `+` read as a space.
 */
export function goQueryKeys(rawQuery: string): string[] {
  const keys: string[] = [];
  for (const pair of rawQuery.split('&')) {
    if (pair === '' || pair.includes(';')) continue;
    const eq = pair.indexOf('=');
    const rawKey = eq < 0 ? pair : pair.slice(0, eq);
    const key = unescapeText(rawKey.replace(/\+/g, ' '), Mode.Path);
    if (key !== null) keys.push(key);
  }
  return keys;
}

/**
 * The reference's `credentialEndpointOrigin`: lower-cased `scheme://host:port`
 * with the scheme's default port filled; a value Go does not parse, or with no
 * scheme or no host, is its trimmed, lower-cased self without trailing slashes.
 */
export function goEndpointOrigin(
  raw: string,
  defaultPorts: Readonly<Record<string, string>>,
  protocolSeparator: string,
): string {
  const trimmed = goTrimSpace(raw);
  const u = goParseSchemeHost(trimmed);
  if (u === null || u.scheme === '' || u.host === '') {
    return goToLower(trimmed.replace(/\/+$/, ''));
  }
  const scheme = goToLower(u.scheme);
  let host = goToLower(u.host);
  const lastColon = host.lastIndexOf(':');
  if (lastColon < 0 || lastColon <= host.lastIndexOf(']')) {
    if (Object.prototype.hasOwnProperty.call(defaultPorts, scheme)) {
      host += `:${defaultPorts[scheme]}`;
    }
  }
  return scheme + protocolSeparator + host;
}
