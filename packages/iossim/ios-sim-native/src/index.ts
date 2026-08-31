/**
 * Service Provider for the iOS-simulator capability seam over the
 * `iossim-helper` native helper (FBSimulatorControl — see
 * [native/iossim-helper](../../../../native/iossim-helper/README.md)). The
 * provider is a thin typed client: it launches one helper per installation,
 * supervises it, and maps its framed answers onto the seam's vocabulary.
 *
 * It declares two capabilities — `describe` (the device availability tree)
 * and `input` (one gesture against either an element reference or a device
 * point) — growing the end-to-end proof of the licence, build, launch, and
 * supervision path capability by capability
 * ([Agent Note](../../../../.agents/notes/implemented/architecture/2026-08-27-ios-simulator-native-provider.md)).
 * Unadvertised verbs reject loudly in the Service Definition gate.
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
  SimulatorError,
  SimulatorId,
} from '@deepseek-ai/dsh-ios-sim'
import type {
  SimulatorCapability,
  SimulatorDescribeRequest,
  SimulatorDescribeResult,
  SimulatorInputRequest,
  SimulatorInputResult,
  SimulatorPoint,
  SimulatorStreamCodec,
  SimulatorStreamHandle,
  SimulatorStreamRequest,
} from '@deepseek-ai/dsh-ios-sim'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { MAX_TIMER_DELAY_MS, clampTimeout, deadline, timeoutOf } from '@deepseek-ai/dsh-timeout'
import { helperPath } from '@deepseek-ai/iossim-helper'
import { SimctlSimulatorProvider } from '@deepseek-ai/dsh-ios-sim-simctl'
import { describeResultFromHelper, inputResultFromHelper, referenceIndexFor } from './describe.ts'
import { startHelper, type LiveHelper } from './helper.ts'

const TIMEOUT_CODE = 'SIMULATOR_HELPER_TIMEOUT'

/** Default wall-clock budget for one helper request. */
const DEFAULT_TIMEOUT_MS = 60_000
const DEFAULT_MAX_OUTPUT_BYTES = 64_000

/** Upper bound of every request budget (config `maxTimeoutMs`). */
const DEFAULT_MAX_TIMEOUT_MS = 600_000

/** Default count of supervised restarts before the provider names the failure. */
const DEFAULT_MAX_RESTARTS = 3

/** SIGTERM→SIGKILL escalation grace for helper teardown. */
const DEFAULT_GRACE_MS = 3_000

/** Default live-stream frame rate cap. */
const DEFAULT_STREAM_FRAME_RATE = 30

/** Default live-stream resolution scale. */
const DEFAULT_STREAM_SCALE = 1

/** The codecs the helper's VideoToolbox path encodes. */
const STREAM_CODECS: readonly string[] = ['h264', 'hevc', 'mjpeg']

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
  /** Max captured bytes per simctl invocation (inherited simctl verbs). */
  maxOutputBytes?: number
  /** Video codec of live streams (`stream`): `h264`, `hevc`, or `mjpeg`. Default: `h264`. */
  streamCodec?: string
  /** Encode at most this many frames per second (`stream`). Default: 30. */
  streamFrameRate?: number
  /** Resolution scale of the encoded output, `1` = native (`stream`). Default: 1. */
  streamScale?: number
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
/**
 * Everything the simctl base serves, plus the helper-backed verbs this
 * provider adds — the one mounted provider covers list/boot/create AND
 * describe/input/stream, so no composition has to choose between them.
 */
const NATIVE_CAPABILITIES: ReadonlySet<SimulatorCapability> = new Set<SimulatorCapability>([
  'list', 'boot', 'create', 'install', 'launch', 'terminate', 'screenshot', 'openUrl',
  'describe', 'input', 'stream',
])

/** The native provider over the helper: describe from phase 2, input from phase 3. */
export class NativeSimulatorProvider extends SimctlSimulatorProvider {
  static override inject = ['subprocess']

  static override Config: z<Config> = z.object({
    helperPath: z.string(),
    timeoutMs: z.number().default(DEFAULT_TIMEOUT_MS),
    maxTimeoutMs: z.number().default(DEFAULT_MAX_TIMEOUT_MS),
    maxRestarts: z.number().default(DEFAULT_MAX_RESTARTS),
    graceMs: z.number().default(DEFAULT_GRACE_MS),
    maxOutputBytes: z.number().default(DEFAULT_MAX_OUTPUT_BYTES),
    streamCodec: z.string().default('h264'),
    streamFrameRate: z.number().default(DEFAULT_STREAM_FRAME_RATE),
    streamScale: z.number().default(DEFAULT_STREAM_SCALE),
  })

  private readonly nativeConfig: ResolvedConfig
  /** The one live helper; a promise so concurrent callers share one launch. */
  private live: Promise<LiveHelper> | undefined
  /** Serialization of helper requests — the helper serves one at a time. */
  private queue: Promise<unknown> = Promise.resolve()
  /** Cumulative supervised restarts consumed by this provider instance. */
  private restartsUsed = 0
  /**
   * The references the provider minted in its most recent describe, keyed by
   * device: an element-target input resolves against THIS cache, because the
   * references are meaningful only within the result that issued them. One
   * entry — the most recent describe — keeps the cache bounded without
   * pretending stale trees stay authoritative.
   */
  private referenceIndex: { device: string; centres: Map<string, SimulatorPoint> } | undefined

  /**
   * Validate config and refuse non-macOS hosts at LOAD time — a misconfigured
   * composition must never sit silently idle pretending nothing happened.
   * @param ctx - cordis context; `ctx.subprocess` comes from inject.
   * @param config - schemastery-resolved composition values.
   */
  constructor(ctx: Context, config: Config) {
    // The simctl base validates macOS, resolves xcrun and the developer dir,
    // and owns list/boot/shutdown/launch/screenshot/create; this provider adds
    // the helper-backed describe/input/stream on top.
    super(ctx, config)
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
    if (!STREAM_CODECS.includes(resolved.streamCodec)) {
      throw new Error(`ios-sim-native: streamCodec must be one of ${STREAM_CODECS.join(', ')}`)
    }
    assertPositiveFinite('streamFrameRate', resolved.streamFrameRate)
    if (resolved.streamFrameRate > 240) {
      throw new Error('ios-sim-native: streamFrameRate must be no greater than 240')
    }
    if (!(Number.isFinite(resolved.streamScale) && resolved.streamScale > 0 && resolved.streamScale <= 1)) {
      throw new Error('ios-sim-native: streamScale must be a finite number in (0, 1]')
    }
    this.nativeConfig = resolved
    // Helper teardown reaches quiescence on unload: terminate the child and
    // wait for its process tree before the composition tears down.
    ctx.effect(() => () => this.killLive(), 'iossim-helper teardown')
  }

  override get capabilities(): ReadonlySet<SimulatorCapability> {
    return NATIVE_CAPABILITIES
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
  resolveHelper(request: { timeoutMs?: number | undefined } = {}): NativeInvocationSpec {
    return {
      helperPath: this.nativeConfig.helperPath ?? helperPath(),
      timeoutMs: clampTimeout(
        request.timeoutMs,
        this.nativeConfig.timeoutMs,
        Math.min(this.nativeConfig.maxTimeoutMs, MAX_TIMER_DELAY_MS),
        'request.timeoutMs',
      ),
      maxRestarts: this.nativeConfig.maxRestarts,
      cwd: tmpdir(),
    }
  }

  protected override async doDescribe(request: SimulatorDescribeRequest): Promise<SimulatorDescribeResult> {
    const spec = this.resolveHelper(request)
    const result = await this.withHelper(
      helper => helper.request('describe', {
        simulatorId: request.simulator === undefined ? null : String(request.simulator),
      }),
      spec,
    )
    const describeResult = describeResultFromHelper(result)
    this.referenceIndex = referenceIndexFor(describeResult)
    return describeResult
  }

  protected override async doInput(request: SimulatorInputRequest): Promise<SimulatorInputResult> {
    const spec = this.resolveHelper(request)
    const action = request.action
    // Element targets resolve against the references this provider minted in
    // its most recent describe; a point target lands where it says. Both
    // forms reduce to one device point before the helper sees the gesture.
    let point: SimulatorPoint | undefined
    let params: Record<string, unknown>
    if (action.kind === 'tap' || action.kind === 'text') {
      const target = action.target
      point = target.kind === 'point' ? target.at : this.resolveReference(request.simulator, target.reference)
      params = action.kind === 'tap'
        ? { action: 'tap', x: point.xPoints, y: point.yPoints }
        : { action: 'text', x: point.xPoints, y: point.yPoints, text: action.text }
    } else if (action.kind === 'swipe') {
      point = action.start
      params = {
        action: 'swipe',
        xStart: action.start.xPoints,
        yStart: action.start.yPoints,
        xEnd: action.end.xPoints,
        yEnd: action.end.yPoints,
        ...(action.durationMs === undefined ? {} : { durationMs: action.durationMs }),
      }
    } else if (action.kind === 'key') {
      params = { action: 'key', usage: action.usage, ...(action.shift === true ? { shift: true } : {}) }
    } else {
      params = { action: 'button', button: action.button }
    }
    const result = await this.withHelper(helper => helper.request('input', params), spec)
    return inputResultFromHelper(result, point)
  }

  protected override async doStreamStart(request: SimulatorStreamRequest): Promise<SimulatorStreamHandle> {
    const spec = this.resolveHelper(request)
    const codec = request.codec ?? this.nativeConfig.streamCodec
    const frameRate = request.frameRate ?? this.nativeConfig.streamFrameRate
    const scale = request.scale ?? this.nativeConfig.streamScale
    const stream = await this.withHelper(
      helper => helper.startVideoStream({
        codec,
        frameRate,
        scale,
        simulatorId: request.simulator === undefined ? null : String(request.simulator),
      }),
      spec,
    )
    const negotiated = stream.codec as SimulatorStreamCodec
    return {
      codec: negotiated,
      frames: stream.chunks,
      stop: () => stream.stop(),
    }
  }

  /**
   * Resolve one element reference against the cached describe. The device the
   * describe served anchors the lookup: naming a DIFFERENT device with an
   * element reference is the same staleness as referencing a tree that was
   * never described.
   * @param requestDevice - the request's device reference, or undefined when the helper resolves.
   * @param reference - the element reference from the request.
   * @returns the device point the reference's frame centre sits at.
   * @throws {SimulatorError} code `SIMULATOR_ELEMENT_REFERENCE_STALE` when no
   *   cached describe anchors the reference.
   */
  private resolveReference(requestDevice: SimulatorId | undefined, reference: string): SimulatorPoint {
    const cache = this.referenceIndex
    if (cache === undefined || (requestDevice !== undefined && String(requestDevice) !== cache.device) || !cache.centres.has(reference)) {
      const context = cache === undefined
        ? 'no describe has been served yet'
        : `the cached describe served device "${cache.device}"`
      throw new SimulatorError(
        `the element reference "${reference}" does not resolve against the cached describe (${context}); `
          + 'call describe again to mint fresh references',
        'SIMULATOR_ELEMENT_REFERENCE_STALE',
      )
    }
    return cache.centres.get(reference) as SimulatorPoint
  }

  /**
   * Run one helper operation with supervision: requests are serialized (the
   * helper serves one at a time), a request that dies with the child consumes
   * one supervised restart and is retried on a fresh helper, and exhausting
   * the bound fails with its own named code — a dead helper surfaces as a
   * simulator failure, never as an agent crash.
   */
  private async withHelper<T>(
    op: (helper: LiveHelper) => Promise<T>,
    spec: NativeInvocationSpec,
  ): Promise<T> {
    const run = async (): Promise<T> => {
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
  private async withDeadline<T>(
    pending: Promise<T>,
    timeoutMs: number,
    onTimeout: () => Promise<void>,
  ): Promise<T> {
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
        graceMs: this.nativeConfig.graceMs,
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
