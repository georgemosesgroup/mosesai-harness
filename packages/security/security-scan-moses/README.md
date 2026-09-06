---
description: "Security-scanning capability seam Service Definition (`ctx.securityScan`): a provider registry plus the enforced target allowlist that is the authorization boundary."
kind: "package-reference"
---

# @deepseek-ai/dsh-security-scan-moses

English | [中文](README.zh.md)

<a id="summary"></a>
## Summary

Service Definition for the security-scanning capability seam (`ctx.securityScan`): a provider registry plus the enforced target allowlist. Owners point the seam at systems they are authorized to test; the allowlist is the authorization boundary, and enforcement lives in the operation that accepts targets, so direct service callers cannot bypass it.

## Table of Contents

- [The service](#the-service)
- [Config](#config)
- [Allowlist semantics](#allowlist-semantics)
- [Extension points](#extension-points)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="the-service"></a>
## The service

`SecurityScanRuntime` publishes `ctx.securityScan` and exposes:

- `registerProvider(provider)` — adds a `SecurityScanProvider`; duplicate ids throw `SECURITY_DUPLICATE_PROVIDER`. Returns the effect-scoped disposer.
- `scan(request, signal?)` — normalizes and dedupes `targets`, bounds the count (`maxTargetsPerScan`), rejects any host outside the allowlist (`SECURITY_TARGET_NOT_ALLOWLISTED`, with the offending host named), selects the provider for `request.scanner`, and forwards `{ ...request, targets }`.

Selection mirrors [`dsh-web`](../../web/web/README.md): a configured id that is missing throws `SECURITY_PROVIDER_CONFIGURED_MISSING`, registered-but-unusable throws `SECURITY_PROVIDER_CONFIGURED_UNAVAILABLE`; otherwise exactly one usable provider wins, several usable throw `SECURITY_PROVIDER_AMBIGUOUS`, and none throws `SECURITY_PROVIDER_UNAVAILABLE`. Usability is asked per requested scanner.

<a id="config"></a>
## Config

- `allowlist` (required) — authorized entries; empty or malformed fails the load (`SECURITY_ALLOWLIST_EMPTY` / `SECURITY_ALLOWLIST_ENTRY_INVALID`, the latter naming the element).
- `maxTargetsPerScan` — default 8.
- `provider` — optional pinned provider id for the selection rules above.

<a id="allowlist-semantics"></a>
## Allowlist semantics

Entries authorize HOSTS. The port never participates: an allowed host is allowed on any port over any scheme.

- `example.com`, `www.example.com` — exactly that host; subdomains are not covered.
- `.example.com` — the apex plus subdomains of any depth.
- IPv4 / IPv6 literals — exactly that address.
- `10.0.0.0/24`, `2001:db8::/32` — CIDR ranges, implemented bitwise without new dependencies. Non-canonical network addresses (host bits set, e.g. `10.0.0.5/24`) are rejected rather than normalized.

Targets normalize through `new URL(...)` or a `host[:port]` form: lowercase, brackets and trailing dots removed, ports stripped. Targets carrying userinfo (`user@host`) are rejected outright (`SECURITY_TARGET_INVALID`). Pure functions (`parseAllowlistEntry`, `normalizeTarget`, `targetAllowed`) live in [`src/allowlist.ts`](src/allowlist.ts) and are exported for tests.

<a id="extension-points"></a>
## Extension points

Deployments add reachability by registering additional providers — remote sandboxes, brokered runner fleets — into `registerProvider`; the allowlist boundary stays in the seam regardless of provider.

## Model Experience

Indirectly, through `dsh-tool-security-scan-moses`; this seam enforces target authorization and delegates all model rendering to it.

#### KV Cache effect

None; nothing here participates in request assembly or history retention.

## Known Limitations and Deferred Work

- **IDN is out of scope** — non-ASCII hosts are rejected at parse time; deployments serving IDN names authorize their punycode ASCII form instead.
- **Ports are not authorizable** — a host on the list is reachable on every port; there is deliberately no per-port syntax.
- **Session events are deferred** — scans do not append dedicated session-log events; observability today is the tool result itself.
- **Dynamic allowlists are deferred** — the list comes from composition config only; a settings-backed hot-reload path is future work.
- **Background scans are deferred** — long scans run inside the consumer's cooperative timeout; a `ctx.jobs` producer is future work.

<a id="dev-note"></a>
### Dev Note

None.
