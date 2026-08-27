# 会话协调

[English](session-coordination.md) | 中文

面向同一主机上多个并行 DSH 会话的个人跨会话协调插件：TTL 路径租约（"claim"），加上阻止写入型工具调用落入其他会话存活租约的结构化强制。一个包承担该接缝的全部角色——服务（[dsh-session-coordination-moses](../../packages/session/session-coordination-moses)，`ctx.sessionCoordination`）、四个模型可见的 `workspace_*` 工具，以及 `tools/pre-execute` 强制监听器。它不属于任何随发行束；部署通过 profile 补丁层启用。

源码：[`packages/session/session-coordination-moses/src/index.ts`](../../packages/session/session-coordination-moses/src/index.ts)

## 租约

租约（`WorkspaceClaim`，由 [`claims-core.ts`](../../packages/session/session-coordination-moses/src/claims-core.ts) 定义）记录持有者会话 id、覆盖的 glob 模式（受支持的 `/` 分隔子集：`**` 匹配整段、`*` 与 `?` 在单段内）、获取时间、过期时间，以及在拒绝消息中展示给其他会话的可选备注。租约在每次访问时、由周期定时器、以及持有会话释放时被清扫。当另一会话的存活租约与请求模式重叠时，acquire 以 `ClaimConflictError` 拒绝——基于见证路径的重叠检测为前期交互提供尽力而为的反馈，而写入时的逐路径 `check()` 才是唯一的仲裁。

## 强制

`tools/pre-execute` 监听器检查目标路径落在其他会话存活租约下的写入型工具调用（`enforcedTools`，默认 `write`/`edit`），并遵循 `bypassPaths`。模式：`off`、`deny`（默认）或 `ask`。缺少 agent 绑定的调用不拥有任何路径，因此任何外部租约仍然适用。Shell 命令被有意地不解析也不拦截——任意命令无法可靠解析，且每个 acquire/claims 描述都说明了这一点。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxsessioncoordination--sessioncoordinationservice"></a>

### `ctx.sessionCoordination` — `SessionCoordinationService`

The published `ctx.sessionCoordination` service: one process-wide lease table shared by every session of this host. All methods are synchronous; expired leases are swept on access and by a periodic timer.

```ts cordis-catalog
/**
 * Take one lease for `sessionId`.
 * @param sessionId - owning caller session id (`exec.agent.session.id`).
 * @param patterns - non-empty glob patterns the lease covers.
 * @param ttlMs - requested lifetime in milliseconds, capped by `maxTtlMs`.
 * @param note - optional free-text reason other sessions see in denials.
 * @returns the stored claim, detached from the store.
 * @throws `ClaimConflictError` when another session's live claim overlaps.
 */
acquire(sessionId: string, patterns: readonly string[], ttlMs: number, note?: string): WorkspaceClaim

/**
 * Release every claim of one session.
 * @param sessionId - session whose claims are dropped.
 * @returns how many live claims were removed.
 */
release(sessionId: string): number

/**
 * All live claims, earliest-expiring first; sweeps expired leases first.
 * @returns detached copies of every live claim.
 */
list(): WorkspaceClaim[]

/**
 * The live claim covering one concrete path, or `null`.
 * @param path - concrete `/`-separated path to test against live claims.
 * @returns detached copy of the oldest covering claim, or `null`.
 */
check(path: string): WorkspaceClaim | null
```

Source: [`packages/session/session-coordination-moses/src/index.ts`](../../packages/session/session-coordination-moses/src/index.ts)
<!-- END GENERATED cordis-surface -->
