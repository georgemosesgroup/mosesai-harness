---
description: "Package map for the security-scanning plane: the capability seam with its enforced target allowlist, the whitelisted-argv local provider, and the model-facing scan tool."
kind: "package-group"
---

# security/ — security-scanning control plane

English | [中文](README.zh.md)

## Summary

The security group runs model-driven vulnerability scans behind two structural authorization boundaries: which targets are in scope, and which CLI flags may reach a scanner binary. The seam enforces the target allowlist inside its own runtime before any provider lookup; the local provider owns per-scanner whitelist tables so flag injection is unrepresentable rather than merely forbidden. Start with the seam and the local provider, then add the tool that projects one scan verb to the model. This page maps the group; every package README owns its contract, and the [security subsystem page](../../docs/subsystems/security.md) is the reference for the enforced vocabulary.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`security-scan-moses/`](security-scan-moses/README.md) | Defines the `ctx.securityScan` seam: the enforced target allowlist, provider selection, and the scan request/result types | `ctx.securityScan` |
| [`security-scan-local-moses/`](security-scan-local-moses/README.md) | Local provider over `ctx.subprocess`: per-scanner whitelisted-argv tables, deadline and spill caps, PATH resolution | registers on `ctx.securityScan` |
| [`tool-security-scan-moses/`](tool-security-scan-moses/README.md) | Projects one `security_scan` tool onto the seam, with option narrowing and a bounded rendered result | `ctx.tools` |

-----

<a id="related-documentation"></a>
## Related documentation

- [Security subsystem](../../docs/subsystems/security.md) — the enforced target allowlist, the whitelisted-argv boundary, and provider selection.

<a id="dev-note"></a>
## Dev Note

None.
