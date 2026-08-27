/**
 * Service Provider for the iOS-simulator capability seam over the
 * `iossim-helper` native helper (FBSimulatorControl — see
 * [native/iossim-helper](../../../../native/iossim-helper/README.md)). The
 * provider is a thin typed client: it launches one helper per installation,
 * supervises it, and maps its framed answers onto the seam's vocabulary.
 *
 * It declares exactly one capability — `describe`, the device availability
 * tree — because one capability is the end-to-end proof of the licence,
 * build, and launch path before any of them carries more
 * ([Agent Note](../../../../.agents/notes/proposed/architecture/2026-08-27-ios-simulator-native-provider.md)).
 * Unadvertised verbs reject loudly in the Service Definition gate, and
 * `input` stays a rejecting `Promise<never>` until phase 3.
 *
 * The helper resolves request targets itself (it owns the CoreSimulator
 * device-set binding): an omitted reference requires exactly ONE booted
 * device there, with the seam's own failure codes — this module's explicit
 * `resolve` step therefore plans the call (helper path, deadline, restart
 * bound) rather than resolving a device list it cannot see.
 *
 * @module @deepseek-ai/dsh-ios-sim-native
 */

import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  IosSimulator,
  SimulatorError,
} from '@deepseek-ai/dsh-ios-sim'
import type {
  SimulatorCapability,
  SimulatorDescribeRequest,
  SimulatorDescribeResult,
} from '@deepseek-ai/dsh-ios-sim'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { MAX_TIMER_DELAY_MS, clampTimeout, deadline, timeoutOf } from '@deepseek-ai/dsh-timeout'
import { helperPath } from '@deepseek-ai/iossim-helper'
import { describeResultFromHelper } from './describe.ts'
import { startHelper, type LiveHelper } from './helper.ts'

const TIMEOUT_CODE = 'SIMULATOR_HELPER_TIMEOUT'

/** Default wall-clock budget for one helper request. */
const DEFAULT_TIMEOUT_MS = 60_000

/** Upper bound of every request budget (config `maxTimeoutMs`). */
const DEFAULT_MAX_TIMEOUT_MS = 600_000

/** Default count of supervised restarts before the provider names the failure. */
const DEFAULT_MAX_RESTARTS = 3

/** SIGTERM→SIGKILL escalation grace for helper teardown. */
const DEFAULT_GRACE_MS = 3_000

/** Plugin config (all optional — `static Config` supplies the defaults). */
export interface Config {
  /**
   * Explicit helper-binary path overriding the entry package's resolution —
   * the test-injection and custom-install escape hatch. Never read from the
   * environment: which binary serves simulator operations is composition
   * state, not ambient state.
   */
  helperPath?: string
  /** Default helper-request deadline in milliseconds. */
  timeoutMs?: number
  /** Upper bound for every helper-request deadline. */
  maxTimeoutMs?: number
  /** Supervised restarts before `SIMULATOR_HELPER_SUPERVISION_EXHAUSTED`; cumulative for this provider's lifetime. */
  maxRestarts?: number
  /** Grace period for kill escalation; at most `MAX_TIMER_DELAY_MS`. */
  graceMs?: number
}

/** Shape after schemastery applied the defaults: every knob is filled except
 * `helperPath`, whose entry-package resolution is a runtime decision. */
type ResolvedConfig = Required<Omit<Config, 'helperPath'>> & { helperPath?: string | undefined }

/**
 * A fully defaulted request plan produced by {@link NativeSimulatorProvider.resolve}
 * — the explicit defaults step (the `dsh-shell` request/spec split); verb
 * bodies never apply their own hidden fallbacks.
 */
export interface NativeInvocationSpec {
  /** Absolute path of the helper binary this provider will speak to. */
  readonly helperPath: string
  /** Effective deadline in milliseconds (defaulted by config, capped, timer-bounded). */
  readonly timeoutMs: number
  /** Effective supervised-restart bound. */
  readonly maxRestarts: number
  /** Working directory for the helper child. */
  readonly cwd: string
}

function assertPositiveFinite(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`ios-sim-native: ${name} must be a positive finite number`)
  }
}

/** The native provider's declaration set: one capability, on purpose. */
const PROVIDER_CAPABILITIES: ReadonlySet<SimulatorCapability> = new Set<SimulatorCapability>([
  'describe',
])

/** The phase-2 provider over the native helper. */
export class NativeSimulatorProvider extends IosSimulator {
  static inject = ['subprocess']

  static Config: z<Config> = z.object({
    helperPath: z.string(),
    timeoutMs: z.number().default(DEFAULT_TIMEOUT_MS),
    maxTimeoutMs: z.number().default(DEFAULT_MAX_TIMEOUT_MS),
    maxRestarts: z.number().default(DEFAULT_MAX_RESTARTS),
    graceMs: z.number().default(DEFAULT_GRACE_MS),
  })

  private readonly config: ResolvedConfig
  /** The one live helper; a promise so concurrent callers share one launch. */
  private live: Promise<LiveHelper> | undefined
  /** Serialization of helper requests — the helper serves one at a time. */
  private queue: Promise<unknown> = Promise.resolve()
  /** Cumulative supervised restarts consumed by this provider instance. */
  private restartsUsed = 0

  /**
   * Validate config and refuse non-macOS hosts at LOAD time — a misconfigured
   * composition must never sit silently idle pretending nothing happened.
   * @param ctx - cordis context; `ctx.subprocess` comes from inject.
   * @param config - schemastery-resolved composition values.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx)
    if (process.platform !== 'darwin') {
      throw new SimulatorError(
        `the native simulator provider runs only on macOS (process.platform is "${process.platform}"); `
          + 'do not mount dsh-ios-sim-native elsewhere',
        'SIMULATOR_PLATFORM_UNSUPPORTED',
      )
    }
    const resolved = config as ResolvedConfig
    assertPositiveFinite('timeoutMs', resolved.timeoutMs)
    assertPositiveFinite('maxTimeoutMs', resolved.maxTimeoutMs)
    assertPositiveFinite('maxRestarts', resolved.maxRestarts)
    assertPositiveFinite('graceMs', resolved.graceMs)
    if (resolved.graceMs > MAX_TIMER_DELAY_MS) {
      throw new Error(`ios-sim-native: graceMs must be no greater than ${MAX_TIMER_DELAY_MS}`)
    }
    if (resolved.maxTimeoutMs < resolved.timeoutMs) {
      throw new Error('ios-sim-native: maxTimeoutMs must be no less than timeoutMs')
    }
    this.config = resolved
    // Helper teardown reaches quiescence on unload: terminate the child and
    // wait for its process tree before the composition tears down.
    ctx.effect(() => () => this.killLive(), 'iossim-helper teardown')
  }

  override get capabilities(): ReadonlySet<SimulatorCapability> {
    return PROVIDER_CAPABILITIES
  }

  override get providerName(): string {
    return '@deepseek-ai/dsh-ios-sim-native'
  }

  /**
   * Apply implementation-owned defaults and caps to one verb call before any
   * helper work: helper-path resolution, deadline clamping, and the restart
   * bound land here ONCE (the `dsh-shell` template), never inside verb bodies.
   *
   * @param request - the caller's verb request; optional knobs get resolved here.
   * @returns the fully-resolved plan for one helper request family.
   */
  resolve(request: { timeoutMs?: number | undefined } = {}): NativeInvocationSpec {
    return {
      helperPath: this.config.helperPath ?? helperPath(),
      timeoutMs: clampTimeout(
        request.timeoutMs,
        this.config.timeoutMs,
        Math.min(this.config.maxTimeoutMs, MAX_TIMER_DELAY_MS),
        'request.timeoutMs',
      ),
      maxRestarts: this.config.maxRestarts,
      cwd: tmpdir(),
    }
  }

  override async describe(request: SimulatorDescribeRequest): Promise<SimulatorDescribeResult> {
    const spec = this.resolve(request)
    const result = await this.withHelper(
      helper => helper.request('describe', {
        simulatorId: request.simulator === undefined ? null : String(request.simulator),
      }),
      spec,
    )
    return describeResultFromHelper(result)
  }

  /**
   * Run one helper operation with supervision: requests are serialized (the
   * helper serves one at a time), a request that dies with the child consumes
   * one supervised restart and is retried on a fresh helper, and exhausting
   * the bound fails with its own named code — a dead helper surfaces as a
   * simulator failure, never as an agent crash.
   */
  private async withHelper(
    op: (helper: LiveHelper) => Promise<Record<string, unknown>>,
    spec: NativeInvocationSpec,
  ): Promise<Record<string, unknown>> {
    const run = async (): Promise<Record<string, unknown>> => {
      for (;;) {
        const helper = await this.ensureSession(spec)
        try {
          return await this.withDeadline(op(helper), spec.timeoutMs, async () => this.killLive())
        } catch (cause) {
          const recoverable = cause instanceof SimulatorError && cause.code === 'SIMULATOR_HELPER_UNAVAILABLE'
          if (!recoverable) throw cause
          // The child died under us: drop the session and let the bound
          // decide whether a fresh helper is still an option.
          await this.killLive()
          this.restartsUsed += 1
          if (this.restartsUsed > spec.maxRestarts) {
            throw new SimulatorError(
              `the iossim-helper child died ${this.restartsUsed} times, past the supervised restart bound of `
                + `${spec.maxRestarts}; check the helper installation (config helperPath, the `
                + '@deepseek-ai/iossim-helper platform package) before mounting dsh-ios-sim-native again',
              'SIMULATOR_HELPER_SUPERVISION_EXHAUSTED',
              { cause },
            )
          }
        }
      }
    }
    const settled = this.queue.then(run, run)
    this.queue = settled.catch(() => undefined)
    return settled
  }

  /** Bound one helper request by the spec's deadline; a breach kills the stuck child. */
  private async withDeadline(
    pending: Promise<Record<string, unknown>>,
    timeoutMs: number,
    onTimeout: () => Promise<void>,
  ): Promise<Record<string, unknown>> {
    using fused = deadline(undefined, timeoutMs, TIMEOUT_CODE)
    const breached = new Promise<never>((_, reject) => {
      fused.signal.addEventListener('abort', () => {
        reject(new SimulatorError(`iossim-helper exceeded its ${timeoutMs} ms deadline`, TIMEOUT_CODE))
      }, { once: true })
    })
    // A late child death after a deadline breach must not surface as an
    // unhandled rejection: the twin swallows what nobody awaits.
    void pending.catch(() => undefined)
    try {
      return await Promise.race([pending, breached])
    } catch (cause) {
      if (timeoutOf(fused.signal, TIMEOUT_CODE) !== undefined) {
        await onTimeout()
        throw new SimulatorError(
          `iossim-helper exceeded its ${timeoutMs} ms deadline; the stuck child was terminated`,
          TIMEOUT_CODE,
          { cause },
        )
      }
      throw cause
    }
  }

  /** The shared live session, launched lazily on first use; a failed launch clears itself. */
  private ensureSession(spec: NativeInvocationSpec): Promise<LiveHelper> {
    if (this.live === undefined) {
      this.live = startHelper({
        path: spec.helperPath,
        spawn: (spawnSpec: SubprocessSpawnSpec): SubprocessHandle => this.ctx.subprocess.spawn(spawnSpec),
        cwd: spec.cwd,
        graceMs: this.config.graceMs,
      })
    }
    return this.live
  }

  /** Terminate the live helper, if any, and wait for its process tree to exit. */
  private async killLive(): Promise<void> {
    const live = this.live
    this.live = undefined
    if (live === undefined) return
    try {
      const helper = await live
      await helper.close()
    } catch {
      // A failed launch left nothing to kill: the next request starts fresh.
    }
  }
}

export default NativeSimulatorProvider
