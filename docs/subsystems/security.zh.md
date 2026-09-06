# 安全扫描

[English](security.md) | 中文

安全扫描 seam 将授权范围内的外部 CLI 扫描器（nuclei、httpx、katana、ffuf、nmap、sqlmap）封装在统一的 `ctx.securityScan` 中间层之后：Service Definition（[dsh-security-scan-moses](../../packages/security/security-scan-moses)，即本页的词汇表、提供方注册表与强制执行的 allowlist）、Service Provider（[dsh-security-scan-local-moses](../../packages/security/security-scan-local-moses)，白名单化 argv 构建与 subprocess 执行）以及 Consumer（[dsh-tool-security-scan-moses](../../packages/security/tool-security-scan-moses)，`security_scan` 的 schema 与提示词指引）。

Source: [`packages/security/security-scan-moses/src/types.ts`](../../packages/security/security-scan-moses/src/types.ts)

## 授权是 seam 自身的属性

部署配置中的 `allowlist` 即授权边界：targets 会在 `SecurityScanRuntime.scan` 内部被规范化为主机并与该列表匹配，且发生在任何提供方运行之前，因此直接调用服务无法绕过。授权以主机为单位——端口从不参与，允许的主机在任意端口、任意 scheme 下均可达。条目形态：精确主机、`.domain`（apex 与任意深度子域）、IPv4/IPv6 字面量、按位实现的 CIDR v4+v6（非规范网络地址会被拒绝而非归一化）。IDN 域名必须以 punycode 形式给出。

提供方注册的是能力（`SecurityScanProvider`）而非工具；面向模型的名称、schema、提示词指引与呈现全部位于唯一的 `dsh-tool-security-scan-moses` consumer。提供方选择逻辑与 [`dsh-web`](web.zh.md) 一致：优先已配置 id（missing/unavailable 分别报错），否则恰好一个可用于所请求扫描器的提供方，否则 ambiguous 或 unavailable。

## 扫描请求与结果

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


## 提供方契约

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

`available()` 在选择时针对所请求的 scanner 单独询问。它只是选择的输入，不是健康检查系统。

## 错误分类

`SecurityScanError extends HarnessError`（见 [core.md](core.zh.md) 错误分类），携带封闭的 `SECURITY_` 前缀码集合。注册期：`SECURITY_DUPLICATE_PROVIDER`、`SECURITY_ALLOWLIST_EMPTY`、`SECURITY_ALLOWLIST_ENTRY_INVALID`。目标期：`SECURITY_TARGET_INVALID`、`SECURITY_TARGET_NOT_ALLOWLISTED`、`SECURITY_TOO_MANY_TARGETS`。选择期：`SECURITY_PROVIDER_CONFIGURED_MISSING`、`SECURITY_PROVIDER_CONFIGURED_UNAVAILABLE`、`SECURITY_PROVIDER_AMBIGUOUS`、`SECURITY_PROVIDER_UNAVAILABLE`。选项期：`SECURITY_OPTION_UNKNOWN`、`SECURITY_OPTION_INVALID`。执行期：`SECURITY_EXEC_FAILED`。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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
