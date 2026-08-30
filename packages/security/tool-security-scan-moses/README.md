---
description: "Model-facing security_scan tool over the security-scanning seam, owning the schema, prompt guidance, budgets, and presentation while the seam owns authorization and execution."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-security-scan-moses

English | [中文](README.zh.md)

<a id="summary"></a>
## Summary

Model-facing `security_scan` tool over [`dsh-security-scan-moses`](../security-scan-moses/README.md). This package owns the schema, prompt guidance, budgets, and presentation; the seam owns authorization, provider selection, and execution. The tool stays visible when a scanner binary is missing and fails with a structured seam error at execution time (the `tool-web` precedent).

## Table of Contents

- [The tool](#the-tool)
- [Config](#config)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="the-tool"></a>
## The tool

- `scanner` — enum of enabled scanners (config-filtered subset of nuclei/httpx/katana/ffuf/nmap/sqlmap).
- `targets` — array of URLs or `host[:port]` strings; every host must be on the deployment allowlist.
- `options` — open object; values are narrowed to string/number/boolean/string-array at this edge and validated against the provider's per-scanner whitelist beyond it. Raw argv is unrepresentable.

The canonical result carries the executed argv, exit facts (`exitCode`/`signal`), cause flags (`timedOut`/`aborted`), duration, and both captured streams with truncation and spill paths. Rendered output is one text section capped to `maxOutputChars` (default 20000) with a truncation footer, applied to the complete text once known.

<a id="config"></a>
## Config

`scanners` (per-id enablement), `timeoutMs` (600000) attached as `ToolDefinition.timeoutMs`, and `maxOutputChars` (20000). Scans declare `isConcurrencySafe: false`, so sibling calls serialize around them.

### Enablement

Mount all three packages in any composition patch layer. For a user web profile, add to `$DSH_HOME/profiles/web/cordis.patch.yml`:

```yaml
- insert:
    - id: security-scan
      name: '@deepseek-ai/dsh-security-scan-moses'
      config:
        allowlist: ['staging.example.com']

    - id: security-scan-local
      name: '@deepseek-ai/dsh-security-scan-local-moses'

    - id: tool-security-scan
      name: '@deepseek-ai/dsh-tool-security-scan-moses'
```

Verify with `dsh --profile web --dump-config | grep security-scan`; the tool appears in newly created sessions.

## Model Experience

### Request context and condition

#### What the model sees

A `tool:security_scan` system-prompt section (order 112) establishing that scanning is authorized only against owner-owned resources whose deployment allowlist is the boundary, recommending httpx → nuclei → targeted tools ordering and staging-first sqlmap use, plus the `security_scan` schema entry in the generated [tool catalog](../../../docs/tool-catalog.md).

##### Verbatim text for this field, when needed

```markdown
security_scan runs authorized vulnerability scans against resources OWNED by the user (the deployment allowlist is the authorization boundary — targets outside it fail). Recommended order: httpx to confirm live hosts, nuclei for broad templated checks, then targeted tools for specific questions. Run sqlmap only on an explicit task and prefer staging copies of applications; always pass a short note via options when relevant.
```

#### Token effect

Fixed: the section adds roughly 90 tokens once per agent request while the plugin is mounted, and the schema adds its own catalog-sized entry; disabling every scanner in config registers neither.

#### KV Cache effect

Append-only and prefix-stable within a session for as long as the composition is unchanged; reloading this plugin or editing its `scanners`/prompt text replaces that prefix slice on the next request.

## Known Limitations and Deferred Work

- **Whitelist-only options** — scanner flags outside the frozen whitelists cannot be passed at all; widening is a code change by design.
- **Exclusive execution** — scans never join parallel sibling groups; heavy fan-out waits.
- **No background mode** — long scans live inside the tool's cooperative timeout; a `ctx.jobs` producer is deferred.
- **Structured errors over silent skips** — an unavailable binary surfaces `SECURITY_PROVIDER_UNAVAILABLE` at execution rather than hiding the tool.

<a id="dev-note"></a>
### Dev Note

None.
