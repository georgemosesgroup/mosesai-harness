---
description: "Local security-scanning Service Provider that resolves installed scanner binaries and runs them through the subprocess seam with hard per-scanner option whitelists — never a shell."
kind: "package-reference"
---

# @deepseek-ai/dsh-security-scan-local-moses

English | [中文](README.zh.md)

<a id="summary"></a>
## Summary

Local Service Provider for the security-scanning seam: resolves installed scanner binaries, builds argv from hard per-scanner option whitelists, and runs the process through [`dsh-subprocess`](../../subprocess/subprocess/README.md) — never a shell.

## Table of Contents

- [How a scan runs](#how-a-scan-runs)
- [Config](#config)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="how-a-scan-runs"></a>
## How a scan runs

1. `available(scanner)` checks `binPaths[scanner]` on disk (executable bit required) or searches `$PATH`; it never spawns.
2. The provider plans argv with [`src/scanners.ts`](src/scanners.ts): every option must appear in the scanner's whitelist, integers honor per-flag ranges, booleans add their flag, strings may never start with `-` (anti flag-injection), string arrays render comma-joined with the same check. Unknown names throw `SECURITY_OPTION_UNKNOWN` listing the allowed set; bad values throw `SECURITY_OPTION_INVALID`. There is no passthrough — `extraArgs` cannot be expressed.
3. Execution uses one `deadline()` combining the caller's signal with `timeoutMs` (capped by `maxTimeoutMs`); `timedOut`/`aborted` classify by first cause exactly like the bash executor. Spawn or run failures surface as `SECURITY_EXEC_FAILED` with the cause attached.

Scanner-specific policy baked into the provider: sqlmap always leads with `--batch` (interactivity is unreachable); nuclei defaults to `-json` and `-exclude-tags dos` (overridable); ffuf requires `url` containing the `FUZZ` keyword plus a `wordlist`, resolved against `wordlistDirs` or accepted as an existing absolute path.

<a id="config"></a>
## Config

`binPaths`, `wordlistDirs`, `cwd` (default `process.cwd()`), `timeoutMs` (600000), `maxTimeoutMs` (3600000 — security scans legitimately run long), `maxOutputBytes` (64000), `maxSpillBytes` (64 MiB), `graceMs` (3000, bounded by the Node timer ceiling). Child processes get the terminal-friendly environment (`NO_COLOR`/`TERM=dumb`/`PAGER=cat`) over the subprocess service's scrubbed base.

## Model Experience

Indirectly, through `dsh-tool-security-scan-moses`; this provider backend delegates all model rendering to it.

#### KV Cache effect

None; nothing here participates in request assembly or history retention.

## Known Limitations and Deferred Work

- **No binary provisioning** — the provider never downloads or installs scanners; missing binaries fail with `SECURITY_PROVIDER_UNAVAILABLE`.
- **One target for sqlmap; none for ffuf** — sqlmap drives a single `-u` URL and ffuf is driven by its FUZZ `url` option, so multi-target scans are only available on positional-target scanners (nuclei/httpx/katana/nmap).
- **POSIX-tested** — unit fixtures are POSIX shell scripts and CI coverage runs there; Windows execution of the real scanners is untested.
- **OWASP ZAP is absent** — the ZAP provider is deferred in this iteration; the seam's registry accepts one when it exists.

<a id="dev-note"></a>
### Dev Note

None.
