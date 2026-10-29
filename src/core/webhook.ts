// Webhook URL vetting — the PORTABLE HALF of Go lagotto
// pkg/watcher/validation.go ValidateWebhookURL (v0.64.1).
//
// ⚠ This is NOT an SSRF defence, and is deliberately not named like one.
// Go's validator resolves the host and rejects any name that does not resolve
// (fail-closed, lagotto#40) or that resolves to a blocked address, and the Go
// notifier re-vets the post-resolution IP at dial time to defeat DNS rebinding.
// A browser has no DNS API and no dialer hook, so none of that can be reproduced
// here: a hostname that RESOLVES to 10.0.0.1 or 169.254.169.254 passes this
// check. Only the syntactic gate survives:
//   - the scheme must be https, and there must be a host;
//   - a host that IS a literal loopback / private / link-local / unspecified IP
//     is rejected (WHATWG URL parsing normalises `0x7f.1`, `2130706433` etc. to
//     dotted form first, so those obfuscations are caught);
//   - names that by specification can only mean loopback (`localhost`,
//     `*.localhost`, RFC 6761) or can never resolve (`*.invalid`) are rejected,
//     standing in for the two outcomes Go gets from a real lookup.
// The threat model differs too: a browser fetch runs from the USER's network
// position, not a Lambda's. Whatever stores the webhook for a server to call
// must run Go's full validator (or an equivalent) server-side.

const BLOCK = {
  loopback: "webhook must not target loopback addresses",
  private: "webhook must not target private network addresses",
  linkLocal: "webhook must not target link-local addresses (includes EC2 metadata service)",
  unspecified: "webhook must not target unspecified addresses",
} as const;

/**
 * Syntactic webhook check (see the module comment for what it can NOT do).
 * Throws with Go's messages on a non-https scheme, a missing host, or a host
 * that is a literal blocked IP; returns normally otherwise.
 */
export function validateWebhookURLSyntax(raw: string): void {
  // The authority as written. WHATWG parsing would read "https:///webhook" as
  // host "webhook"; Go's url.Parse reads it as an empty host, and so do we.
  const authority = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/([^/?#]*)/.exec(raw);
  let u: URL;
  try {
    u = new URL(raw);
  } catch (e) {
    throw new Error(`invalid URL: ${(e as Error).message}`, { cause: e });
  }
  const scheme = u.protocol.replace(/:$/, "");
  if (scheme !== "https") throw new Error(`webhook URL must use HTTPS (got ${JSON.stringify(scheme)})`);
  if (!authority || authority[1] === "" || u.hostname === "") throw new Error("webhook URL must have a host");

  const host = u.hostname.toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) {
    const v6 = parseIPv6(host.slice(1, -1));
    if (v6) return checkIPv6(v6);
    throw new Error(`invalid URL: bad IPv6 host ${JSON.stringify(host)}`);
  }
  const v4 = parseIPv4(host);
  if (v4) return checkIPv4(v4);

  const name = host.replace(/\.$/, "");
  if (name === "localhost" || name.endsWith(".localhost")) throw new Error(BLOCK.loopback);
  if (name === "invalid" || name.endsWith(".invalid")) {
    throw new Error(`webhook host ${JSON.stringify(u.hostname)} could not be resolved: reserved .invalid name`);
  }
}

type V4 = [number, number, number, number];

function parseIPv4(s: string): V4 | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  const o = m.slice(1).map(Number);
  return o.every((n) => n <= 255) ? (o as V4) : null;
}

/** Go net.IP Is* predicates for an IPv4 address. */
function checkIPv4([a, b, c, d]: V4): void {
  if (a === 127) throw new Error(BLOCK.loopback); // IsLoopback: 127/8
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) throw new Error(BLOCK.private);
  // IsLinkLocalUnicast 169.254/16 (incl. 169.254.169.254); IsLinkLocalMulticast 224.0.0/24.
  if ((a === 169 && b === 254) || (a === 224 && b === 0 && c === 0)) throw new Error(BLOCK.linkLocal);
  if (a === 0 && b === 0 && c === 0 && d === 0) throw new Error(BLOCK.unspecified);
}

/** Parse an IPv6 literal into 8 16-bit groups (supports `::` and a dotted v4 tail). */
function parseIPv6(s: string): number[] | null {
  let tail: number[] = [];
  const lc = s.lastIndexOf(":");
  if (lc >= 0 && s.slice(lc + 1).includes(".")) {
    const v4 = parseIPv4(s.slice(lc + 1));
    if (!v4) return null;
    tail = [(v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]];
    s = s.slice(0, lc + 1);
    if (!s.endsWith("::")) s = s.slice(0, -1);
  }
  const want = 8 - tail.length;
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const groups = (h: string) => (h === "" ? [] : h.split(":"));
  const head = groups(halves[0]!);
  const back = halves.length === 2 ? groups(halves[1]!) : [];
  if (![...head, ...back].every((g) => /^[0-9a-f]{1,4}$/i.test(g))) return null;
  let mid: string[] = [];
  if (halves.length === 2) {
    if (head.length + back.length > want - 1) return null;
    mid = new Array<string>(want - head.length - back.length).fill("0");
  } else if (head.length !== want) {
    return null;
  }
  return [...head, ...mid, ...back].map((g) => parseInt(g, 16)).concat(tail);
}

/** Go net.IP Is* predicates for IPv6, treating IPv4-mapped (::ffff:a.b.c.d) as IPv4 like Go. */
function checkIPv6(g: number[]): void {
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
    const v4: V4 = [g[6]! >> 8, g[6]! & 0xff, g[7]! >> 8, g[7]! & 0xff];
    return checkIPv4(v4);
  }
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) throw new Error(BLOCK.loopback);
  if ((g[0]! & 0xfe00) === 0xfc00) throw new Error(BLOCK.private);
  if ((g[0]! & 0xffc0) === 0xfe80 || (g[0]! & 0xff0f) === 0xff02) throw new Error(BLOCK.linkLocal);
  if (g.every((x) => x === 0)) throw new Error(BLOCK.unspecified);
}
