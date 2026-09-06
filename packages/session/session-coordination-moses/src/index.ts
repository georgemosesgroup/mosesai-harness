/**
 * session-coordination-moses — path leases ("claims") for coexisting DSH
 * sessions of ONE host process, plus structural enforcement that blocks
 * write-shaped tool calls into another session's LIVE claim.
 *
 * Provides:
 * - `ctx.sessionCoordination` service (`acquire/release/list/check`) over an
 *   in-memory store; leases are TTL-bounded and dropped when the owning
 *   session disposes.
 * - Model tools `workspace_acquire`, `workspace_release`, `workspace_claims`,
 *   `workspace_check`.
 * - A `tools/pre-execute` listener that denies (or asks for) write/edit calls
 *   whose target path falls under a foreign live claim. Shell tools are
 *   DELIBERATELY not covered — arbitrary commands cannot be parsed reliably;
 *   the limitation is stated in every acquire/claims description.
 *
 * Caller identity follows the same production precedent as the session-query
 * tools: `exec.agent.session.id`; a call without an agent binding is refused
 * by the workspace tools and treated as owning nothing by enforcement.
 *
 * @module @deepseek-ai/dsh-session-coordination-moses
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { PreToolDecision, ToolDefinition, ToolExecution } from '@deepseek-ai/dsh-tools'
// Pulls the `session/*` declaration merges so `ctx.on('session/disposed')` is typed.
import type {} from '@deepseek-ai/dsh-session'
import {
  ClaimConflictError,
  ClaimStore,
  conflictMessage,
  globMatch,
  type WorkspaceClaim,
} from './claims-core.ts'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'session-coordination-moses'

/** Capability services required by the tools and the usage-guidance section. */
export const inject = ['tools', 'systemPrompt']

/** Deployment-owned lease bounds, enforcement mode, and always-allowed paths. */
export interface Config {
  /** Lease lifetime used when a call omits `ttlMinutes`. Defaults to 15. */
  defaultTtlMinutes?: number
  /** Upper bound any lease may request. Defaults to 120. */
  maxTtlMinutes?: number
  /** Write-path enforcement: `off`, `deny`, or `ask`. Defaults to `deny`. */
  enforcement?: 'off' | 'deny' | 'ask'
  /** Tool names the enforcement inspects. Defaults to `['write', 'edit']`. */
  enforcedTools?: string[]
  /** Path patterns writes are always allowed into, claim or no claim. */
  bypassPaths?: string[]
}

/** Schemastery config for Loader validation and defaults. */
export const Config: z<Config> = z.object({
  defaultTtlMinutes: z.number().step(1).min(1).max(24 * 60).default(15),
  maxTtlMinutes: z.number().step(1).min(1).max(24 * 60).default(120),
  enforcement: z.union(['off', 'deny', 'ask']).default('deny'),
  enforcedTools: z.array(z.string()).default(['write', 'edit']),
  bypassPaths: z.array(z.string()).default([]),
})

interface ResolvedConfig {
  readonly defaultTtlMs: number
  readonly maxTtlMs: number
  readonly enforcement: 'off' | 'deny' | 'ask'
  readonly enforcedTools: readonly string[]
  readonly bypassPatterns: readonly string[]
}

/** Validate schema-defaulted config loudly; bad values fail the load.
 * @param config - the raw Loader-interpolated config.
 * @returns the fully-resolved deployment bounds.
 */
export function resolveConfig(config: Config): ResolvedConfig {
  const defaultTtlMs = (config.defaultTtlMinutes ?? 15) * 60_000
  const maxTtlMs = (config.maxTtlMinutes ?? 120) * 60_000
  if (!Number.isSafeInteger(defaultTtlMs) || defaultTtlMs <= 0) {
    throw new TypeError('session-coordination: defaultTtlMinutes must be a positive integer')
  }
  if (!Number.isSafeInteger(maxTtlMs) || maxTtlMs <= 0 || maxTtlMs < defaultTtlMs) {
    throw new TypeError('session-coordination: maxTtlMinutes must be ≥ defaultTtlMinutes')
  }
  // schemastery's z.union already constrains enforcement to the three literals.
  const enforcement = config.enforcement ?? 'deny'
  return {
    defaultTtlMs,
    maxTtlMs,
    enforcement,
    enforcedTools: config.enforcedTools ?? ['write', 'edit'],
    bypassPatterns: config.bypassPaths ?? [],
  }
}

/**
 * The published `ctx.sessionCoordination` service: one process-wide lease
 * table shared by every session of this host. All methods are synchronous;
 * expired leases are swept on access and by a periodic timer.
 */
export class SessionCoordinationService extends Service {
  private readonly store: ClaimStore

  constructor(ctx: Context, bounds: { readonly maxTtlMs: number }) {
    super(ctx, 'sessionCoordination')
    this.store = new ClaimStore(() => Date.now(), bounds)
  }

  /**
   * Take one lease for `sessionId`.
   * @param sessionId - owning caller session id (`exec.agent.session.id`).
   * @param patterns - non-empty glob patterns the lease covers.
   * @param ttlMs - requested lifetime in milliseconds, capped by `maxTtlMs`.
   * @param note - optional free-text reason other sessions see in denials.
   * @returns the stored claim, detached from the store.
   * @throws `ClaimConflictError` when another session's live claim overlaps.
   */
  acquire(sessionId: string, patterns: readonly string[], ttlMs: number, note?: string): WorkspaceClaim {
    return this.store.acquire({ sessionId, patterns, ttlMs, now: Date.now(), ...(note === undefined ? {} : { note }) })
  }

  /**
   * Release every claim of one session.
   * @param sessionId - session whose claims are dropped.
   * @returns how many live claims were removed.
   */
  release(sessionId: string): number {
    return this.store.release(sessionId)
  }

  /**
   * All live claims, earliest-expiring first; sweeps expired leases first.
   * @returns detached copies of every live claim.
   */
  list(): WorkspaceClaim[] {
    return this.store.list()
  }

  /**
   * The live claim covering one concrete path, or `null`.
   * @param path - concrete `/`-separated path to test against live claims.
   * @returns detached copy of the oldest covering claim, or `null`.
   */
  check(path: string): WorkspaceClaim | null {
    return this.store.check(path)
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    sessionCoordination: SessionCoordinationService
  }
}

/** The stable calling-session id; production precedent is `exec.agent.session.id`. */
function callerOf(exec: ToolExecution): string {
  const agent = exec.agent
  if (agent === undefined) {
    throw new Error('workspace coordination requires an agent-bound caller')
  }
  return agent.session.id
}

/** Extract the write target from known argument spellings; `undefined` = unknown. */
function targetPathOf(args: unknown): string | undefined {
  if (typeof args !== 'object' || args === null) return undefined
  const record = args as Record<string, unknown>
  for (const key of ['file_path', 'path', 'filePath'] as const) {
    const value = record[key]
    if (typeof value === 'string' && value.trim().length > 0) return value
  }
  return undefined
}

const CLAIM_SHAPE = {
  sessionId: { type: 'string', required: true },
  patterns: { type: 'array', required: true, items: { type: 'string' } },
  acquiredAt: { type: 'integer', required: true },
  expiresAt: { type: 'integer', required: true },
  note: { type: 'string' },
} as const

function claimValueOf(claim: WorkspaceClaim): WorkspaceClaim {
  return {
    sessionId: claim.sessionId,
    patterns: [...claim.patterns],
    acquiredAt: claim.acquiredAt,
    expiresAt: claim.expiresAt,
    ...(claim.note === undefined ? {} : { note: claim.note }),
  }
}

function renderClaim(claim: WorkspaceClaim): string {
  return [
    `- owner ${claim.sessionId}`,
    `patterns: ${claim.patterns.join(', ')}`,
    `until ${new Date(claim.expiresAt).toISOString()}`,
    claim.note === undefined ? '' : `note: ${claim.note}`,
  ].filter(line => line !== '').join(' | ')
}

const ENFORCEMENT_LIMITS =
  'Enforcement covers structured write tools only (configurable, default write/edit). '
  + 'Shell commands are deliberately NOT parsed or blocked — coordinate shell edits yourself.'

/** Model-facing lease etiquette, registered as a system-prompt section. */
const USAGE_SECTION_TEXT =
  'Path leases: several parallel sessions of this DSH install work over shared repositories. '
  + 'Before starting work that will write into areas another session may also touch, call '
  + 'workspace_acquire on the glob patterns you are about to modify (keep the TTL honest), and '
  + 'call workspace_release when you finish. If a write is denied by session-coordination, do not '
  + 'retry blindly: run workspace_claims to see the owner and expiry, then coordinate, pick '
  + 'disjoint paths, or wait for the lease to lapse. Never use shell commands to circumvent '
  + 'another session\'s live lease — shell is not enforced, so respecting it is on you.'

/**
 * Build the four lease tools against an explicit coordination service.
 * Split from {@link apply} so tests drive the exact registered bodies with a
 * plain service instance and stub execs.
 *
 * @param coordination - the lease service the tools operate through.
 * @param resolved - validated deployment bounds.
 * @returns the four registry-ready definitions, in registration order.
 */
export function createCoordinationTools(
  coordination: SessionCoordinationService,
  resolved: ResolvedConfig,
): ToolDefinition[] {
  const assertPatterns = (patterns: readonly unknown[]): string[] => {
    if (patterns.length === 0) throw new Error('patterns must contain at least one entry')
    return patterns.map((pattern) => {
      if (typeof pattern !== 'string' || pattern.trim().length === 0) {
        throw new Error('every pattern must be a non-empty string')
      }
      return pattern
    })
  }
  const tools: ToolDefinition[] = []
  tools.push(defineTool({
    name: 'workspace_acquire',
    description:
      'Acquire a TTL-bounded lease on path patterns for THIS session. Other sessions\' structured '
      + 'writes under a live foreign lease are denied until it expires or is released. '
      + ENFORCEMENT_LIMITS,
    parameters: {
      patterns: {
        type: 'array',
        required: true,
        items: { type: 'string' },
        description: 'Glob patterns relative to paths as you would write them (**, *, ? supported).',
      },
      ttlMinutes: { type: 'integer', description: `Lease minutes, 1..max. Default ${resolved.defaultTtlMs / 60_000}.` },
      note: { type: 'string', description: 'Short reason other sessions will see in denial messages.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { ...CLAIM_SHAPE } },
      render: (_args, value: WorkspaceClaim) => [{
        type: 'text',
        text: `Leased until ${new Date(value.expiresAt).toISOString()} for this session:\n${renderClaim(value)}`,
      }],
    },
    presentCall: args => ({ card: 'generic', kind: 'read', title: 'workspace_acquire', rawInput: args }),
    async execute(args, exec): Promise<WorkspaceClaim> {
      const caller = callerOf(exec)
      const patterns = assertPatterns(args.patterns)
      if (args.ttlMinutes !== undefined && (!Number.isSafeInteger(args.ttlMinutes) || args.ttlMinutes < 1)) {
        throw new Error('ttlMinutes must be a positive integer')
      }
      const ttlMs = Math.min(
        args.ttlMinutes === undefined ? resolved.defaultTtlMs : args.ttlMinutes * 60_000,
        resolved.maxTtlMs,
      )
      try {
        return await Promise.resolve(claimValueOf(coordination.acquire(caller, patterns, ttlMs, args.note)))
      } catch (error) {
        if (error instanceof ClaimConflictError) throw new Error(error.message)
        throw error
      }
    },
  }))
  tools.push(defineTool({
    name: 'workspace_release',
    description:
      'Release ALL path leases held by THIS session. Others may write immediately afterwards. '
      + ENFORCEMENT_LIMITS,
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { released: { type: 'integer', required: true } } },
      render: (_args, value: { released: number }) => [{
        type: 'text', text: `Released ${value.released} lease(s) held by this session.`,
      }],
    },
    presentCall: args => ({ card: 'generic', kind: 'read', title: 'workspace_release', rawInput: args }),
    execute(_args, exec) {
      return Promise.resolve({ released: coordination.release(callerOf(exec)) })
    },
  }))
  tools.push(defineTool({
    name: 'workspace_claims',
    description:
      'List every live path lease in this install: owners, patterns, expiries, notes. '
      + ENFORCEMENT_LIMITS,
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { claims: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { ...CLAIM_SHAPE } } } },
      },
      render: (_args, value: { claims: WorkspaceClaim[] }) => [{
        type: 'text',
        text: value.claims.length === 0
          ? 'No live claims.'
          : `${value.claims.length} live claim(s):\n${value.claims.map(renderClaim).join('\n')}`,
      }],
    },
    presentCall: args => ({ card: 'generic', kind: 'read', title: 'workspace_claims', rawInput: args }),
    execute() {
      const claims = coordination.list()
      return Promise.resolve({ claims: claims.map(claimValueOf) })
    },
  }))
  tools.push(defineTool({
    name: 'workspace_check',
    description:
      'Check whether one path is under a live lease and who owns it. '
      + ENFORCEMENT_LIMITS,
    parameters: {
      path: { type: 'string', required: true, description: 'Concrete path to test against live claims.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          claimed: { type: 'boolean', required: true },
          claim: { type: 'object', additionalProperties: false, properties: { ...CLAIM_SHAPE } },
        },
      },
      render: (_args, value: { path: string; claimed: boolean; claim?: WorkspaceClaim }) => [{
        type: 'text',
        text: value.claim === undefined
          ? `${value.path}: not claimed.`
          : `${value.path} → ${conflictMessage(value.path, value.claim)}`,
      }],
    },
    presentCall: args => ({ card: 'generic', kind: 'read', title: 'workspace_check', rawInput: args }),
    execute(args) {
      const claim = coordination.check(args.path)
      return Promise.resolve(claim === null
        ? { path: args.path, claimed: false }
        : { path: args.path, claimed: true, claim: claimValueOf(claim) })
    },
  }))
  return tools
}

/**
 * Build the `tools/pre-execute` enforcement handler.
 * @param coordination - the lease service consulted for each write target.
 * @param resolved - validated deployment bounds.
 * @returns the waterfall handler; delegates via `next()` on allow.
 */
export function createEnforcementListener(
  coordination: SessionCoordinationService,
  resolved: ResolvedConfig,
): (exec: ToolExecution, next: () => Promise<PreToolDecision>) => Promise<PreToolDecision> {
  const denyReasonFor = (path: string, claim: Readonly<WorkspaceClaim>): string =>
    `${conflictMessage(path, claim)}. Your writes are blocked by session-coordination; `
    + 'call workspace_claims to see all leases, or coordinate with the owner / wait for expiry.'

  return async (exec, next): Promise<PreToolDecision> => {
    if (resolved.enforcement === 'off') return next()
    if (!resolved.enforcedTools.includes(exec.name)) return next()
    const path = targetPathOf(exec.arguments)
    if (path === undefined) return next()
    if (resolved.bypassPatterns.some(pattern => globMatch(pattern, path))) return next()
    let callerId: string | undefined
    try {
      callerId = callerOf(exec)
    } catch {
      // Unattributed call (direct programmatic dispatch owns nothing), so any
      // foreign live claim still applies — fail closed like any other caller.
      callerId = undefined
    }
    const claim = coordination.check(path)
    if (claim === null || claim.sessionId === callerId) return next()
    const reason = denyReasonFor(path, claim)
    if (resolved.enforcement === 'ask') return { kind: 'ask', reason }
    return { kind: 'deny', reason }
  }
}

/**
 * Publish the service and register the four workspace tools plus the
 * `tools/pre-execute` enforcement listener.
 * @param ctx - the mounting Cordis context.
 * @param config - validated deployment bounds (Loader interpolates defaults).
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config)

  ctx.systemPrompt.section({
    name: 'session-coordination:usage',
    order: 115,
    text: USAGE_SECTION_TEXT,
  })

  // Constructing the Service publishes `ctx.sessionCoordination` synchronously.
  const coordination = new SessionCoordinationService(ctx, { maxTtlMs: resolved.maxTtlMs })

  // Dead sessions release instantly; the TTL below is only a backstop.
  ctx.on('session/disposed', (session) => {
    coordination.release(session.id)
  })

  // Periodic sweep so expiry does not depend on someone calling in.
  ctx.effect(() => {
    const timer = setInterval(() => {
      coordination.list() // list() sweeps first
    }, 60_000)
    return () => {
      clearInterval(timer)
    }
  }, 'sessionCoordination.sweep')

  for (const tool of createCoordinationTools(coordination, resolved)) {
    ctx.tools.register(tool)
  }

  ctx.on('tools/pre-execute', createEnforcementListener(coordination, resolved))
}
