# Agent Note: security-scan capability seam

Status: implemented

English | [中文](2026-08-26-security-scan-seam.zh.md)

## Problem

A model-driven vulnerability scanner is a dual-use capability: the same tool that audits an owner's staging host can attack someone else's. Two authorization decisions had to land structurally rather than procedurally — which TARGETS are in scope, and which CLI FLAGS may reach the scanner binary. Where each decision lives determines whether direct service callers, future consumers, or new providers can bypass it.

## Decision

Target authorization executes inside `SecurityScanRuntime.scan` — normalize, dedupe, bound count, match — before any provider lookup or selection. The matcher is pure and dependency-free (`src/allowlist.ts`): exact hosts, `.domain`, IPv4/IPv6 literals, bitwise CIDR v4+v6 with canonical-network rejection (host bits set → entry rejected, not normalized). Ports sit outside authorization by design: an allowed host is reachable on any port, because port-scoped grants invite copy-paste widening without constraining the threat (unauthorized hosts).

CLI flags never come from the model. The local provider owns per-scanner whitelist tables with typed value rules; values may not start with `-`, arrays render comma-joined under the same rule, and no passthrough field exists, so flag injection is unrepresentable rather than forbidden. Scanner-specific non-negotiables sit beside the tables: sqlmap always receives `--batch`, nuclei defaults `-json`/`-exclude-tags dos`, ffuf requires a `FUZZ` url plus a resolved wordlist.

Provider selection mirrors `ctx.web` exactly (configured id first with distinct missing/unavailable errors; otherwise exactly-one-usable, else ambiguous/unavailable), asked per requested scanner.

## Resolved spec gap

The frozen config listed only `allowlist` and `maxTargetsPerScan`, while the error taxonomy carried `SECURITY_PROVIDER_CONFIGURED_MISSING/_UNAVAILABLE`. Those branches require a configured id, so the runtime config gained `provider?: string`. Without it the branches were unreachable and the coverage gate unpassable; the field also gives multi-provider deployments the explicit control the web seam has.

## Alternatives considered

- Tool-layer enforcement — rejected: every current and future consumer (SDK scripts, jobs producers, additional tools) would re-implement or skip the boundary.
- Provider-side authorization — rejected: multiplies the check per backend and trusts each new provider to remember it.
- Free-form argv with prompt-level guidance — rejected: guidance cannot guarantee what reaches `execve`; the whitelist table can.

## Testing

- Allowlist table, selection branches, spy-cold enforcement, disposal: `packages/security/security-scan-moses/tests/security-scan.spec.ts`.
- Stub-binary execution, injection, deadline/abort classification, spill caps, PATH resolution: `packages/security/security-scan-local-moses/tests/security-scan-local.spec.ts`.
- Render cap boundaries and option narrowing: `packages/security/tool-security-scan-moses/tests/tool-security-scan.spec.ts`.
- Assembled Loader boot over the real subprocess service: `packages/security/tool-security-scan-moses/tests/composition.e2e.ts`.
- Keyless transcript snapshot driving a real turn through the scripted adapter: `examples/headless-agent/tests/snapshots/security-scan/`.

## Consequences

Scanning an unauthorized host is impossible from any composition that mounts this seam, at the cost of rejecting IDN names outright (ASCII/punycode only) and of whitelisted-only options: a scanner flag outside the tables needs a code change by design. Full request-header byte pinning for the new prompt section lives with the ACP snapshot lane, whose recording requires a provider key; the headless lane pins the assembled transcript.
