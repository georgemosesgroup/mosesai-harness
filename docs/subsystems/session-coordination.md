# Session Coordination

English | [中文](session-coordination.zh.md)

Personal cross-session coordination plugin for coexisting DSH sessions of ONE host: TTL path leases ("claims") plus structural enforcement that blocks write-shaped tool calls into another session's live lease. One package plays every role the seam needs — the service ([dsh-session-coordination-moses](../../packages/session/session-coordination-moses), `ctx.sessionCoordination`), the four model-facing `workspace_*` tools, and the `tools/pre-execute` enforcement listener. It is not part of any shipped bundle; deployments enable it through a profile patch layer.

Source: [`packages/session/session-coordination-moses/src/index.ts`](../../packages/session/session-coordination-moses/src/index.ts)

## Leases

A lease (`WorkspaceClaim`, owned by [`claims-core.ts`](../../packages/session/session-coordination-moses/src/claims-core.ts)) records the owner session id, covered glob patterns (the supported `/`-separated subset: `**` whole segments, `*` and `?` within one segment), acquisition time, expiry, and an optional free-text note shown to other sessions in denial messages. Leases are swept on access, by a periodic timer, and when the owning session disposes. Acquire rejects with `ClaimConflictError` when a LIVE claim of ANOTHER session overlaps a requested pattern — best-effort witness-based overlap detection gates early UX, while the per-path `check()` at write time is the only arbitration that matters.

## Enforcement

The `tools/pre-execute` listener inspects write-shaped tool calls (`enforcedTools`, default `write`/`edit`) whose target path falls under a foreign live claim, honoring `bypassPaths`. Modes: `off`, `deny` (default), or `ask`. Calls without an agent binding own nothing, so any foreign claim still applies. Shell commands are deliberately NOT parsed or blocked — arbitrary commands cannot be parsed reliably, and every acquire/claims description says so.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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
