# Security Scanning

English | [中文](security.zh.md)

The security-scanning seam wraps authorized external CLI scanners (nuclei, httpx, katana, ffuf, nmap, sqlmap) behind one `ctx.security`-style middle layer: `ctx.securityScan`. The split mirrors every capability seam — Service Definition ([dsh-security-scan-moses](../../packages/security/security-scan-moses), this page's vocabulary plus the provider registry and the ENFORCED target allowlist), Service Provider ([dsh-security-scan-local-moses](../../packages/security/security-scan-local-moses), whitelisted argv construction and subprocess execution), Consumer ([dsh-tool-security-scan-moses](../../packages/security/tool-security-scan-moses), the `security_scan` schema and prompt guidance).

Source: [`packages/security/security-scan-moses/src/types.ts`](../../packages/security/security-scan-moses/src/types.ts)

## Authorization is a seam property

The deployment's `allowlist` is the authorization boundary: targets are normalized to hosts and matched against it inside `SecurityScanRuntime.scan`, before any provider runs, so direct service callers cannot bypass it. Hosts are the unit of authorization — ports never participate, and an allowed host is reachable on any port over any scheme. Entry forms: exact hosts, `.domain` (apex plus subdomains of any depth), IPv4/IPv6 literals, bitwise CIDR v4+v6 (non-canonical network addresses are rejected, not normalized). IDN names must be given in punycode form.

Providers register capabilities (`SecurityScanProvider`), not tools; the model-facing name, schema, prompt guidance, and presentation live in the single `dsh-tool-security-scan-moses` consumer. Provider selection mirrors [`dsh-web`](web.md): configured id first (missing/unavailable are distinct errors), otherwise exactly one usable provider for the requested scanner, else ambiguous or unavailable.

## Scan request and result

```ts type-equiv
/** The external CLI scanners this seam can drive. */
type SecurityScannerId = 'nuclei' | 'httpx' | 'katana' | 'ffuf' | 'nmap' | 'sqlmap'
```

```ts type-equiv
/** Option values the model may pass; arrays render as comma-joined flags. */
type SecurityScanOptionValue = string | number | boolean | readonly string[]
```

```ts type-equiv
/** One scan request after tool-layer validation. */
interface SecurityScanRequest {
  /** Which scanner to run. */
  readonly scanner: SecurityScannerId
  /** Authorized target URLs or host[:port] strings; allowlist-checked by the runtime. */
  readonly targets: readonly string[]
  /** Scanner-specific options from the provider's whitelist (never raw argv). */
  readonly options?: Readonly<Record<string, SecurityScanOptionValue>>
  /**
   * Directory the scan runs in — the calling agent's workspace.
   *
   * A relative path in an option (`-t ./templates/mine.yaml`, a wordlist) is
   * resolved by the scanner against its working directory, so that directory
   * has to be the project the caller is working in. Without it a scan resolves
   * paths against wherever the host process happens to have been started,
   * which is the harness checkout and never what the caller meant.
   */
  readonly cwd?: string
}
```

```ts type-equiv
/** One captured output stream, structurally compatible with subprocess CollectedOutput. */
interface ScanOutput {
  /** Retained text — the tail of the stream when truncated. */
  readonly text: string
  /** True when bytes were dropped from `text`. */
  readonly truncated: boolean
  /** Path to a file holding the COMPLETE stream, when truncated and spilled. */
  readonly spillPath?: string
}
```

```ts type-equiv
/** The settled outcome of one scan run. `argv` carries no secrets by construction. */
interface SecurityScanResult {
  /** The scanner that ran. */
  readonly scanner: SecurityScannerId
  /** The exact argv executed (binary path plus whitelisted flags and targets). */
  readonly argv: readonly string[]
  /** Exit code; null when the process died from a signal. */
  readonly exitCode: number | null
  /** Terminating signal, when the process died from one. */
  readonly signal: NodeJS.Signals | null
  /** True when THIS provider's deadline fired first. */
  readonly timedOut: boolean
  /** True when an outer cancellation aborted the run before its deadline. */
  readonly aborted: boolean
  /** Wall-clock duration of the run in milliseconds. */
  readonly durationMs: number
  /** Captured stdout. */
  readonly stdout: ScanOutput
  /** Captured stderr. */
  readonly stderr: ScanOutput
}
```


## Provider contract

```ts type-equiv
/** One implementation of the scanning mechanism behind `ctx.securityScan`. */
interface SecurityScanProvider {
  /** Registry key for this provider. */
  readonly id: string
  /**
   * Cheap local check that `scanner` can actually run here (its binary
   * resolves). No network, no spawn.
   */
  available(scanner: SecurityScannerId): boolean
  /** Run one scan; the runtime has already enforced the target allowlist. */
  scan(request: SecurityScanRequest, signal?: AbortSignal): Promise<SecurityScanResult>
}
```

`available()` is asked per requested scanner at selection time. It is an input to selection, not a health system.

## Error taxonomy

`SecurityScanError extends HarnessError` ([core.md](core.md)) with a closed `SECURITY_`-prefixed code set. Registration-time: `SECURITY_DUPLICATE_PROVIDER`, `SECURITY_ALLOWLIST_EMPTY`, `SECURITY_ALLOWLIST_ENTRY_INVALID`. Target-time: `SECURITY_TARGET_INVALID`, `SECURITY_TARGET_NOT_ALLOWLISTED`, `SECURITY_TOO_MANY_TARGETS`. Selection-time: `SECURITY_PROVIDER_CONFIGURED_MISSING`, `SECURITY_PROVIDER_CONFIGURED_UNAVAILABLE`, `SECURITY_PROVIDER_AMBIGUOUS`, `SECURITY_PROVIDER_UNAVAILABLE`. Option-time: `SECURITY_OPTION_UNKNOWN`, `SECURITY_OPTION_INVALID`. Execution-time: `SECURITY_EXEC_FAILED`.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxsecurityscan--securityscanruntime"></a>

### `ctx.securityScan` — `SecurityScanRuntime`

The security-scanning service, registered as `ctx.securityScan`.

```ts cordis-catalog
/**
 * Register one provider. Throws {@link SecurityScanError}
 * `SECURITY_DUPLICATE_PROVIDER` when its id is already registered.
 * @param provider - the provider; its `id` is the registry key.
 * @returns the disposer that unregisters the provider with the calling fiber.
 */
registerProvider(provider: SecurityScanProvider): () => void

/**
 * Run one scan against allowlisted targets through the selected provider.
 * @param request - scanner, targets, and whitelisted options.
 * @param signal - optional cancellation forwarded to the provider.
 * @returns the provider's settled scan result.
 */
async scan(request: SecurityScanRequest, signal?: AbortSignal): Promise<SecurityScanResult>
```

Source: [`packages/security/security-scan-moses/src/index.ts`](../../packages/security/security-scan-moses/src/index.ts)
<!-- END GENERATED cordis-surface -->
