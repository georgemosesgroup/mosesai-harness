/**
 * Allowlist matching for the security-scanning seam: pure parsing and
 * comparison over host-form entries. Entries authorize HOSTS, never ports or
 * schemes — a host on the list is reachable on any port over any scheme.
 *
 * Entry forms (after lowercasing):
 * - `example.com` — exactly that hostname, no subdomains;
 * - `.example.com` — the apex and subdomains of any depth;
 * - IPv4 / IPv6 literals — exactly that address;
 * - `10.0.0.0/24`, `2001:db8::/32` — CIDR ranges; the network address must be
 *   canonical (host bits zero) or the entry is rejected.
 *
 * IDN names are rejected: entries and targets must be ASCII (punycode form
 * when applicable). This is a documented limitation, not an input error class.
 *
 * @module dsh-security-scan/allowlist
 */

import { SecurityScanError } from './errors.ts'

/** One parsed allowlist entry. */
export type AllowlistEntry =
  | { readonly kind: 'exact'; readonly host: string }
  | { readonly kind: 'wildcard-domain'; readonly base: string }
  | { readonly kind: 'cidr'; readonly bytes: Uint8Array; readonly prefix: number; readonly family: 4 | 6 }

/** Valid ASCII hostname (at least one label; labels 1..63, no leading/trailing hyphen). */
const HOSTNAME_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))*$/

/** One explicit capture per octet — a quantified group would keep only its last repetition. */
const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

/** Byte-wise comparison for equal-length address arrays. */
function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index])
}

function invalidEntry(index: number, detail: string): SecurityScanError {
  return new SecurityScanError(`allowlist entry #${index} (${detail})`, 'SECURITY_ALLOWLIST_ENTRY_INVALID')
}

/** Parse one dotted-quad IPv4 into bytes; null when malformed. */
function parseIpv4(text: string): Uint8Array | null {
  const match = IPV4_RE.exec(text)
  if (match === null) return null
  const bytes = new Uint8Array(4)
  for (let index = 0; index < 4; index += 1) {
    const octetText = match[index + 1]
    /* v8 ignore next 1 -- IPV4_RE captures exactly four octet groups. */
    if (octetText === undefined) return null
    const octet = Number(octetText)
    if (octet > 255) return null
    bytes[index] = octet
  }
  return bytes
}

/** Parse one full IPv4 CIDR (`a.b.c.d/p`); null when this is not v4-CIDR shaped. */
function parseIpv4Cidr(text: string): { bytes: Uint8Array; prefix: number } | null {
  const slash = text.indexOf('/')
  if (slash === -1 || text.indexOf('/', slash + 1) !== -1) return null
  const bytes = parseIpv4(text.slice(0, slash))
  if (bytes === null) return null
  const prefix = Number(text.slice(slash + 1))
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null
  return { bytes, prefix }
}

/** Parse one hexadecimal v6 group; null when malformed. */
function parseIpv6Group(group: string): number | null {
  if (group.length < 1 || group.length > 4) return null
  if (!/^[0-9a-f]+$/u.test(group)) return null
  return Number.parseInt(group, 16)
}

/**
 * Parse an IPv6 literal (brackets optional, embedded IPv4 tail allowed) into
 * its 16 bytes; null when malformed. `::` compression appears at most once.
 * @param input - the literal to parse.
 * @returns the 16 address bytes, or null when malformed.
 */
export function parseIpv6(input: string): Uint8Array | null {
  let text = input.toLowerCase()
  if (text.startsWith('[') && text.endsWith(']')) text = text.slice(1, -1)

  // Rewrite an embedded IPv4 tail into two hexadecimal groups up front, so the
  // compressed/uncompressed logic below sees one uniform group vocabulary.
  const lastColon = text.lastIndexOf(':')
  const v4Candidate = lastColon === -1 ? '' : text.slice(lastColon + 1)
  if (v4Candidate.includes('.') && IPV4_RE.test(v4Candidate)) {
    /* v8 ignore start -- IPV4_RE already validated this exact candidate. */
    const bytes = parseIpv4(v4Candidate)
    if (bytes === null) return null
    const b0 = bytes[0] ?? 0
    const b1 = bytes[1] ?? 0
    const b2 = bytes[2] ?? 0
    const b3 = bytes[3] ?? 0
    /* v8 ignore stop */
    const high = ((b0 << 8) | b1).toString(16)
    const low = ((b2 << 8) | b3).toString(16)
    text = `${text.slice(0, lastColon + 1)}${high}:${low}`
  }

  const halves = text.split('::')
  if (halves.length > 2) return null

  const parseGroups = (side: string): number[] | null => {
    if (side === '') return []
    const groups: number[] = []
    for (const group of side.split(':')) {
      const value = parseIpv6Group(group)
      if (value === null) return null
      groups.push(value)
    }
    return groups
  }

  const groupsToBytes = (groups: readonly number[]): Uint8Array => {
    const bytes = new Uint8Array(16)
    groups.forEach((group, index) => {
      bytes[index * 2] = group >> 8
      bytes[index * 2 + 1] = group & 0xff
    })
    return bytes
  }

  if (halves.length === 2) {
    /* v8 ignore next 1 -- split() always yields a first element. */
    const leftGroups = parseGroups(halves[0] ?? '')
    if (leftGroups === null) return null
    /* v8 ignore next 1 -- a trailing '::' yields the empty string here. */
    const rightGroups = parseGroups(halves[1] ?? '')
    if (rightGroups === null) return null
    const filled = 8 - (leftGroups.length + rightGroups.length)
    if (filled < 0) return null
    const middle = new Array<number>(filled).fill(0)
    return groupsToBytes([...leftGroups, ...middle, ...rightGroups])
  }

  const all = parseGroups(text)
  if (all === null || all.length !== 8) return null
  return groupsToBytes(all)
}

/** Parse one IPv6 CIDR (`h::/p`); null when this is not v6-CIDR shaped. */
function parseIpv6Cidr(text: string): { bytes: Uint8Array; prefix: number } | null {
  const slash = text.indexOf('/')
  if (slash === -1) return null
  const bytes = parseIpv6(text.slice(0, slash))
  if (bytes === null) return null
  const prefix = Number(text.slice(slash + 1))
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 128) return null
  return { bytes, prefix }
}

/** Zero the host bits of `bytes` beyond `prefix`; both arrays are same family. */
function applyMask(bytes: Uint8Array, prefix: number): Uint8Array {
  const masked = new Uint8Array(bytes.length)
  let remaining = prefix
  for (let index = 0; index < bytes.length; index += 1) {
    const take = Math.min(8, Math.max(0, remaining))
    const mask = take === 0 ? 0 : (0xff << (8 - take)) & 0xff
    /* v8 ignore next 1 -- masked shares the address length by family construction. */
    masked[index] = (bytes[index] ?? 0) & mask
    remaining -= 8
  }
  return masked
}

/** Parse one allowlist entry.
 * @param entry - the raw allowlist string.
 * @returns the parsed entry.
 * @throws `SecurityScanError` `SECURITY_ALLOWLIST_ENTRY_INVALID` on any malformed input.
 */
export function parseAllowlistEntry(entry: string): AllowlistEntry {
  const text = entry.trim().toLowerCase()
  if (text.length === 0) throw invalidEntry(-1, 'empty')
  if (!/^[\x21-\x7e]+$/u.test(text)) throw invalidEntry(-1, `non-ASCII in "${entry.trim()}"`)

  const cidrV4 = parseIpv4Cidr(text)
  if (cidrV4 !== null) {
    if (!bytesEqual(applyMask(cidrV4.bytes, cidrV4.prefix), cidrV4.bytes)) {
      throw invalidEntry(-1, `CIDR host bits set in "${entry.trim()}"`)
    }
    return { kind: 'cidr', bytes: cidrV4.bytes, prefix: cidrV4.prefix, family: 4 }
  }
  if (IPV4_RE.test(text)) {
    const bytes = parseIpv4(text)
    if (bytes !== null) return { kind: 'exact', host: text }
  }
  if (text.includes(':')) {
    const cidrV6 = parseIpv6Cidr(text)
    if (cidrV6 !== null) {
      if (!bytesEqual(applyMask(cidrV6.bytes, cidrV6.prefix), cidrV6.bytes)) {
        throw invalidEntry(-1, `CIDR host bits set in "${entry.trim()}"`)
      }
      return { kind: 'cidr', bytes: cidrV6.bytes, prefix: cidrV6.prefix, family: 6 }
    }
    const bytes = parseIpv6(text)
    if (bytes !== null) return { kind: 'exact', host: text.replace(/^\[/u, '').replace(/\]$/u, '') }
    throw invalidEntry(-1, `malformed IPv6 in "${entry.trim()}"`)
  }
  if (text.startsWith('.')) {
    const base = text.slice(1)
    if (!HOSTNAME_RE.test(base)) throw invalidEntry(-1, `malformed wildcard domain "${entry.trim()}"`)
    return { kind: 'wildcard-domain', base }
  }
  if (!HOSTNAME_RE.test(text)) throw invalidEntry(-1, `malformed hostname "${entry.trim()}"`)
  return { kind: 'exact', host: text }
}

/**
 * Parse a whole allowlist.
 * @param entries - raw config strings, in order.
 * @returns the parsed entries, order-preserving.
 * @throws `SecurityScanError` `SECURITY_ALLOWLIST_EMPTY` for an empty list,
 *   `SECURITY_ALLOWLIST_ENTRY_INVALID` naming the first bad element.
 */
export function parseAllowlist(entries: readonly string[]): readonly AllowlistEntry[] {
  if (entries.length === 0) {
    throw new SecurityScanError(
      'security-scan requires a non-empty allowlist of authorized targets',
      'SECURITY_ALLOWLIST_EMPTY',
    )
  }
  return entries.map((entry, index) => {
    try {
      return parseAllowlistEntry(entry)
    } catch (cause) {
      // parseAllowlistEntry only throws SECURITY_ALLOWLIST_ENTRY_INVALID with
      // a placeholder index; rethrow with the real position attached.
      throw new SecurityScanError(
        /* v8 ignore next 1 -- parseAllowlistEntry throws plain SecurityScanErrors only. */
        String(cause instanceof Error ? cause.message : cause).replace('#-1', `#${index}`),
        'SECURITY_ALLOWLIST_ENTRY_INVALID',
        { cause },
      )
    }
  })
}

/**
 * Normalize one scan target to the host the allowlist compares against.
 * Accepts a URL or a bare `host[:port]` (IPv6 may be bracketed). The port is
 * stripped and is NOT part of authorization: an allowed host is allowed on any
 * port. Targets carrying userinfo (`user@host`) are rejected outright.
 * @param raw - the caller-supplied target.
 * @returns the lowercased host without brackets or trailing dot.
 * @throws `SecurityScanError` `SECURITY_TARGET_INVALID` for garbage targets.
 */
export function normalizeTarget(raw: string): string {
  const text = raw.trim()
  if (text.length === 0) throw targetInvalid(raw, 'empty target')
  if (text.includes('@')) throw targetInvalid(raw, 'userinfo (credentials) in target')

  if (/^[a-zA-Z][\w+.-]*:\/\//u.test(text)) {
    let url: URL
    try {
      url = new URL(text)
    } catch (error) {
      throw targetInvalid(raw, 'unparseable URL', error)
    }
    // Unreachable through this branch: the leading '@' guard rejects every
    // userinfo form before URL parsing runs.
    /* v8 ignore next 1 */
    if (url.username !== '' || url.password !== '') throw targetInvalid(raw, 'userinfo in URL')
    // WHATWG hostname keeps brackets around IPv6 literals; the bare form is canonical here.
    return finishHost(url.hostname.replace(/^\[/u, '').replace(/\]$/u, ''))
  }

  if (text.startsWith('[')) {
    const close = text.indexOf(']')
    if (close === -1) throw targetInvalid(raw, 'unterminated IPv6 bracket')
    const rest = text.slice(close + 1)
    if (rest !== '' && !/^:\d+$/u.test(rest)) throw targetInvalid(raw, 'garbage after IPv6 bracket')
    return finishHost(text.slice(1, close))
  }
  const colons = text.split(':').length - 1
  if (colons > 1) return finishHost(text) // bare IPv6 cannot carry an unbracketed port
  if (colons === 1) {
    const [host, port, extra] = text.split(':')
    if (host === undefined || port === undefined || extra !== undefined || !/^\d+$/.test(port)) {
      throw targetInvalid(raw, 'malformed host[:port]')
    }
    return finishHost(host)
  }
  return finishHost(text)
}

function finishHost(host: string): string {
  const lowered = host.toLowerCase().replace(/\.$/u, '')
  if (lowered.length === 0) throw targetInvalid(host, 'empty host')
  if (!/^[\x21-\x7e]+$/u.test(lowered)) throw targetInvalid(host, 'non-ASCII host (IDN unsupported)')
  return lowered
}

function targetInvalid(raw: string, detail: string, cause?: unknown): SecurityScanError {
  return new SecurityScanError(`invalid scan target "${raw}" (${detail})`, 'SECURITY_TARGET_INVALID', cause === undefined ? undefined : { cause })
}

/** Whether one normalized host is covered by the parsed allowlist.
 * @param entries - parsed allowlist entries, in priority order.
 * @param host - the normalized host to test.
 * @returns true when any entry covers the host.
 */
export function targetAllowed(entries: readonly AllowlistEntry[], host: string): boolean {
  for (const entry of entries) {
    if (entry.kind === 'exact' && entry.host === host) return true
    if (entry.kind === 'wildcard-domain') {
      if (host === entry.base || host.endsWith(`.${entry.base}`)) return true
    }
    if (entry.kind === 'cidr') {
      const bytes = entry.family === 4 ? parseIpv4(host) : parseIpv6(host)
      if (bytes === null) continue
      const masked = applyMask(bytes, entry.prefix)
      if (bytesEqual(masked, entry.bytes)) return true
    }
  }
  return false
}
