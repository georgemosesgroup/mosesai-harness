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
/** One parsed allowlist entry. */
export type AllowlistEntry = {
  readonly kind: 'exact'
  readonly host: string
} | {
  readonly kind: 'wildcard-domain'
  readonly base: string
} | {
  readonly kind: 'cidr'
  readonly bytes: Uint8Array
  readonly prefix: number
  readonly family: 4 | 6
}
/**
 * Parse an IPv6 literal (brackets optional, embedded IPv4 tail allowed) into
 * its 16 bytes; null when malformed. `::` compression appears at most once.
 * @param input - the literal to parse.
 * @returns the 16 address bytes, or null when malformed.
 */
export declare function parseIpv6(input: string): Uint8Array | null
/** Parse one allowlist entry.
 * @param entry - the raw allowlist string.
 * @returns the parsed entry.
 * @throws `SecurityScanError` `SECURITY_ALLOWLIST_ENTRY_INVALID` on any malformed input.
 */
export declare function parseAllowlistEntry(entry: string): AllowlistEntry
/**
 * Parse a whole allowlist.
 * @param entries - raw config strings, in order.
 * @returns the parsed entries, order-preserving.
 * @throws `SecurityScanError` `SECURITY_ALLOWLIST_EMPTY` for an empty list,
 *   `SECURITY_ALLOWLIST_ENTRY_INVALID` naming the first bad element.
 */
export declare function parseAllowlist(entries: readonly string[]): readonly AllowlistEntry[]
/**
 * Normalize one scan target to the host the allowlist compares against.
 * Accepts a URL or a bare `host[:port]` (IPv6 may be bracketed). The port is
 * stripped and is NOT part of authorization: an allowed host is allowed on any
 * port. Targets carrying userinfo (`user@host`) are rejected outright.
 * @param raw - the caller-supplied target.
 * @returns the lowercased host without brackets or trailing dot.
 * @throws `SecurityScanError` `SECURITY_TARGET_INVALID` for garbage targets.
 */
export declare function normalizeTarget(raw: string): string
/** Whether one normalized host is covered by the parsed allowlist.
 * @param entries - parsed allowlist entries, in priority order.
 * @param host - the normalized host to test.
 * @returns true when any entry covers the host.
 */
export declare function targetAllowed(entries: readonly AllowlistEntry[], host: string): boolean
//# sourceMappingURL=allowlist.d.ts.map
