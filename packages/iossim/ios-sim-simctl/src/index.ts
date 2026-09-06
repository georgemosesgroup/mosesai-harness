/**
 * Service Provider for the iOS-simulator capability seam over the PUBLIC
 * `xcrun simctl` surface. Every substrate interaction spawns through
 * `ctx.subprocess` with a strict argv array (never a shell string), the
 * subcommand word passes one fixed allowlist (the dif-explorer git-run
 * precedent), Xcode is located via `xcode-select -p` instead of any hardcoded
 * application path, and the incompatible misconfiguration states — missing
 * Xcode tooling, missing iOS platform, target absent / not booted / ambiguous
 * — fail with DISTINCT repair messages. The provider declares no `describe`,
 * `input`, or `stream` capability: the public `simctl` substrate offers no
 * availability-tree read, no touch injection, and no video encoding, so no
 * provider over it can ever implement those verbs — they need the native
 * provider ([Agent Note](../../../../.agents/notes/implemented/architecture/2026-08-27-ios-simulator-native-provider.md)) —
 * and unadvertised verbs reject loudly in the Service Definition gate.
 *
 * Device geometry in points is deliberately not reported: the public simctl
 * surface exposes no verifiable point-size fact (verified against current
 * Xcode installs — device/runtime profile plists carry no display dimensions),
 * so launch results carry {@link GEOMETRY_UNAVAILABLE_NOTE} rather than
 * invented values.
 *
 * @module @deepseek-ai/dsh-ios-sim-simctl
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  GEOMETRY_UNAVAILABLE_NOTE,
  IosSimulator,
  SimulatorError,
  SimulatorId,
} from '@deepseek-ai/dsh-ios-sim'
import type {
  SimulatorBootRequest,
  SimulatorCapability,
  SimulatorResolvedTarget,
  SimulatorDevice,
  SimulatorInstallRequest,
  SimulatorLaunchRequest,
  SimulatorLaunchResult,
  SimulatorListRequest,
  SimulatorCreateRequest,
  SimulatorDeviceCatalog,
  SimulatorOpenUrlRequest,
  SimulatorScreenshot,
  SimulatorTargetedRequest,
  SimulatorTerminateRequest,
  SimulatorShutdownRequest,
} from '@deepseek-ai/dsh-ios-sim'
import type { SubprocessHandle, SubprocessOutputReader, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { MAX_TIMER_DELAY_MS, clampTimeout, deadline, timeoutOf } from '@deepseek-ai/dsh-timeout'
import { parseDeviceList, parseLaunchOutput, parseDeviceCatalog, parseCreatedDeviceId, pngPixelSize } from './parse.ts'

/**
 * The complete set of simctl subcommands this provider may ever spawn.
 * Arguments after the subcommand are shaped by this module per verb — caller
 * text lands in argv only through typed request fields (`udid`, path, URL).
 */
export const SIMCTL_ALLOWLIST: ReadonlySet<string> = new Set([
  'list',
  'boot',
  'shutdown',
  'create',
  'install',
  'launch',
  'terminate',
  'openurl',
  'io',
])

/** The only nested `simctl io` verb this provider uses. */
const IO_ALLOWLIST: ReadonlySet<string> = new Set(['screenshot'])

const TIMEOUT_CODE = 'SIMCTL_TIMEOUT'

/** Default wall-clock budget for one substrate invocation. */
const DEFAULT_TIMEOUT_MS = 60_000

/** Upper bound of every invocation budget (config `maxTimeoutMs`). */
const DEFAULT_MAX_TIMEOUT_MS = 600_000

/** Per-stream in-memory capture cap (no spill: simctl outputs stay small). */
const DEFAULT_MAX_OUTPUT_BYTES = 64_000

/** SIGTERM→SIGKILL escalation grace for one substrate child. */
const DEFAULT_GRACE_MS = 3_000

/** Plugin config (all optional — `static Config` supplies the defaults). */
export interface Config {
  /** Default simctl-call deadline in milliseconds. */
  timeoutMs?: number
  /** Upper bound for every simctl-call deadline. */
  maxTimeoutMs?: number
  /** Per-stream stdout/stderr capture cap in bytes. */
  maxOutputBytes?: number
  /** Grace period for kill escalation; at most `MAX_TIMER_DELAY_MS`. */
  graceMs?: number
}

/** Shape after schemastery applied the defaults. */
type ResolvedConfig = Required<Config>

/**
 * A fully defaulted/capped substrate-call plan produced by
 * {@link SimctlSimulatorProvider.resolve} — the explicit defaults step (the
 * `dsh-shell` request/spec split); verb bodies never apply their own hidden
 * fallbacks.
 */
export interface SimctlInvocationSpec {
  /** Absolute path of the resolved `xcrun` executable. */
  readonly xcrunPath: string
  /** Validated developer directory backing iOS simulator support. */
  readonly developerDir: string
  /** Effective deadline in milliseconds (defaulted by config, capped, timer-bounded). */
  readonly timeoutMs: number
  /** Effective per-stream capture cap in bytes. */
  readonly maxOutputBytes: number
  /** Working directory for the substrate child (the host temp root today). */
  readonly cwd: string
}

function assertPositiveFinite(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`ios-sim-simctl: ${name} must be a positive finite number`)
  }
}

/**
 * Interpret trimmed `xcode-select -p` output; split out pure so its two
 * distinct repair hints stay testable on every platform.
 *
 * @param output - raw stdout of the probe invocation.
 * @returns the developer-directory path.
 * @throws {SimulatorError} code `SIMULATOR_XCODE_NOT_RESOLVED`.
 */
export function developerDirFromSelectOutput(output: string): string {
  const candidate = output.trim().split('\n')[0]?.trim() ?? ''
  if (candidate.length === 0 || !candidate.startsWith('/')) {
    throw new SimulatorError(
      'Xcode tooling was not found: `xcode-select -p` returned no developer directory '
        + '(empty output means no full Xcode is selected). Install Xcode, then run '
        + '`sudo xcode-select -s /Applications/Xcode.app/Contents/Developer` and retry.',
      'SIMULATOR_XCODE_NOT_RESOLVED',
    )
  }
  return candidate
}

/**
 * Reject a developer directory that cannot back the iOS simulator platform — a
 * DIFFERENT repair than a stale selection (platform components install inside
 * Xcode).
 *
 * @param developerDir - path reported by `xcode-select -p`.
 * @returns the same directory when valid.
 * @throws {SimulatorError} `SIMULATOR_XCODE_NOT_RESOLVED` when the layout is
 *   gone, or `SIMULATOR_IOS_SDK_MISSING` when Xcode lacks the iOS platform.
 */
export function assertIosDeveloperDir(developerDir: string): string {
  if (!existsSync(join(developerDir))) {
    throw new SimulatorError(
      `\`xcode-select -p\` reports "${developerDir}", but that path does not exist on disk `
        + '(a partial uninstall or move left the selection stale). Re-select a real Xcode with '
        + '`sudo xcode-select -s <path>/Contents/Developer` and retry.',
      'SIMULATOR_XCODE_NOT_RESOLVED',
    )
  }
  if (!existsSync(join(developerDir, 'Platforms', 'iPhoneOS.platform'))) {
    throw new SimulatorError(
      `Xcode at "${developerDir}" carries no iPhoneOS.platform, so no iOS simulator can exist. `
        + 'Install the iOS platform (Xcode → Settings → Components, or `xcodebuild -downloadPlatform iOS`), then retry.',
      'SIMULATOR_IOS_SDK_MISSING',
    )
  }
  return developerDir
}

/**
 * Resolve the verb target against one listing. This IS the seam's explicit
 * target-defaulting step: an omitted reference requires EXACTLY ONE booted
 * device, and each failure mode carries its own code and hint.
 *
 * @param devices - the substrate's current listing.
 * @param requested - the caller's reference, or undefined to auto-pick.
 * @returns the resolved target id.
 * @throws {SimulatorError} `SIMULATOR_DEVICE_NOT_FOUND`,
 *   `SIMULATOR_DEVICE_NOT_BOOTED`, or `SIMULATOR_TARGET_AMBIGUOUS`.
 */
export function resolveSimulatorTarget(
  devices: readonly SimulatorDevice[],
  requested?: SimulatorId  ,
): SimulatorId {
  if (requested !== undefined) {
    const hit = devices.find(device => String(device.id) === String(requested))
    if (hit === undefined) {
      throw new SimulatorError(
        `no available simulator matches "${String(requested)}" (${devices.length} visible). `
          + 'Call sim_list first and use one of its ids verbatim.',
        'SIMULATOR_DEVICE_NOT_FOUND',
      )
    }
    return hit.id
  }
  const booted = devices.filter(device => device.state === 'booted')
  if (booted.length === 0) {
    throw new SimulatorError(
      'no simulator reference was given and no simulator is booted. Boot one outside this harness '
        + '(e.g. `simctl boot <udid>` or `open -a Simulator`) and retry.',
      'SIMULATOR_DEVICE_NOT_BOOTED',
    )
  }
  if (booted.length > 1) {
    throw new SimulatorError(
      `${booted.length} simulators are booted and none was named (${booted.map(d => `"${d.name}" ${d.id}`).join(', ')}). `
        + 'Pass an explicit device id.',
      'SIMULATOR_TARGET_AMBIGUOUS',
    )
  }
  const pick = booted[0]
  /* v8 ignore start -- length > 1 guarantees a member; naming it beats casting. */
  if (pick === undefined) {
    throw new SimulatorError('the booted-device listing emptied between guards', 'SIMCTL_OUTPUT_PARSE_FAILED')
  }
  /* v8 ignore stop */
  return pick.id
}

/** The level-0 provider over the public simctl surface. */
export class SimctlSimulatorProvider extends IosSimulator {
  static inject = ['subprocess']

  static Config: z<Config> = z.object({
    timeoutMs: z.number().default(DEFAULT_TIMEOUT_MS),
    maxTimeoutMs: z.number().default(DEFAULT_MAX_TIMEOUT_MS),
    maxOutputBytes: z.number().default(DEFAULT_MAX_OUTPUT_BYTES),
    graceMs: z.number().default(DEFAULT_GRACE_MS),
  })

  private readonly config: ResolvedConfig
  private readonly xcrunPathMemo: Promise<string>
  private readonly developerDirMemo: Promise<string>

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
        `the simctl simulator provider runs only on macOS (process.platform is "${process.platform}"); `
          + 'do not mount dsh-ios-sim-simctl elsewhere',
        'SIMULATOR_PLATFORM_UNSUPPORTED',
      )
    }
    const resolved = config as ResolvedConfig
    assertPositiveFinite('timeoutMs', resolved.timeoutMs)
    assertPositiveFinite('maxTimeoutMs', resolved.maxTimeoutMs)
    assertPositiveFinite('maxOutputBytes', resolved.maxOutputBytes)
    assertPositiveFinite('graceMs', resolved.graceMs)
    if (resolved.graceMs > MAX_TIMER_DELAY_MS) {
      throw new Error(`ios-sim-simctl: graceMs must be no greater than ${MAX_TIMER_DELAY_MS}`)
    }
    this.config = resolved
    this.xcrunPathMemo = ctx.subprocess.resolveExecutable('xcrun').catch((cause: unknown) => {
      throw new SimulatorError(
        'the `xcrun` launcher was not found in this process\'s execution world; '
          + 'install the Xcode command-line tools (`xcode-select --install`) or mount dsh-ios-sim-simctl '
          + 'in a composition whose subprocess service can see Xcode',
        'SIMULATOR_XCODE_NOT_RESOLVED',
        { cause },
      )
    })
    this.developerDirMemo = this.xcrunPathMemo.then(async () => {
      // The selection probe runs ONCE per process: `xcode-select -p` answers instantly.
      const xcodeSelect = await ctx.subprocess.resolveExecutable('xcode-select')
      using fused = deadline(undefined, this.config.timeoutMs, TIMEOUT_CODE)
      const handle = ctx.subprocess.spawn({
        argv: [xcodeSelect, '-p'],
        cwd: tmpdir(),
        stdio: { stdin: 'ignore', stdout: { maxBytes: this.config.maxOutputBytes }, stderr: { maxBytes: this.config.maxOutputBytes } },
        graceMs: this.config.graceMs,
        signal: fused.signal,
      })
      await handle.done
      const collected = SimctlSimulatorProvider.collected(handle)
      return developerDirFromSelectOutput(collected.stdout.readFrom(0).text)
    }).then(assertIosDeveloperDir)
  }

  override get capabilities(): ReadonlySet<SimulatorCapability> {
    return PROVIDER_CAPABILITIES
  }

  override get providerName(): string {
    return '@deepseek-ai/dsh-ios-sim-simctl'
  }

  /**
   * Apply implementation-owned defaults and caps to one verb call before any
   * substrate work: launcher resolution, the validated developer dir,
   * deadline clamping, and capture budgets land here ONCE (the `dsh-shell`
   * template), never inside verb bodies.
   *
   * @param request - the caller's verb request; optional knobs get resolved here.
   * @returns the fully-resolved plan for one substrate call family.
   */
  async resolve(request: { timeoutMs?: number | undefined } = {}): Promise<SimctlInvocationSpec> {
    return {
      xcrunPath: await this.xcrunPathMemo,
      developerDir: await this.developerDirMemo,
      timeoutMs: clampTimeout(
        request.timeoutMs,
        this.config.timeoutMs,
        Math.min(this.config.maxTimeoutMs, MAX_TIMER_DELAY_MS),
        'request.timeoutMs',
      ),
      maxOutputBytes: this.config.maxOutputBytes,
      cwd: tmpdir(),
    }
  }

  override async list(request: SimulatorListRequest = {}): Promise<readonly SimulatorDevice[]> {
    const spec = await this.resolve(request)
    const { stdout } = await this.runSimctl(spec, ['list'], ['devices', '--json'])
    return parseDeviceList(stdout)
  }

  override async boot(request: SimulatorBootRequest): Promise<SimulatorResolvedTarget> {
    const spec = await this.resolve(request)
    const { devices } = await this.listing(spec)
    const id = resolveSimulatorTarget(devices, request.simulator)
    await this.runVerbSpec(spec, 'boot', [String(id)], IDENTITY_BOOTED)
    return { simulatorId: id }
  }

  override async shutdown(request: SimulatorShutdownRequest): Promise<SimulatorResolvedTarget> {
    const spec = await this.resolve(request)
    const { devices } = await this.listing(spec)
    const id = resolveSimulatorTarget(devices, request.simulator)
    await this.runVerbSpec(spec, 'shutdown', [String(id)], IDENTITY_SHUTDOWN)
    return { simulatorId: id }
  }

  /**
   * Create a device via `simctl create`, then re-list to report the
   * substrate's canonical name and resolved runtime rather than the request echo.
   * @param request - the name plus device-type and runtime identifiers.
   * @returns the new device as `list` observes it.
   */
  override async doCreate(request: SimulatorCreateRequest): Promise<SimulatorDevice> {
    const spec = await this.resolve()
    const { stdout } = await this.runSimctl(
      spec, ['create'],
      [request.name, request.deviceTypeIdentifier, request.runtimeIdentifier],
    )
    const id = parseCreatedDeviceId(stdout)
    // Re-list rather than synthesize: the new device's canonical name and
    // resolved runtime come from the substrate, not the request echo.
    const { devices } = await this.listing(spec)
    const created = devices.find(device => device.id === id)
    if (created !== undefined) return created
    return {
      id,
      name: request.name,
      state: 'shutdown',
      deviceTypeIdentifier: request.deviceTypeIdentifier,
      runtimeIdentifier: request.runtimeIdentifier,
    }
  }

  /**
   * List the host's device types and runtimes via `simctl list devicetypes/runtimes -j`.
   * @returns the device-type and runtime catalog `create` draws from.
   */
  override async doListDeviceTypes(): Promise<SimulatorDeviceCatalog> {
    const spec = await this.resolve()
    const [types, runtimes] = await Promise.all([
      this.runSimctl(spec, ['list'], ['devicetypes', '--json']),
      this.runSimctl(spec, ['list'], ['runtimes', '--json']),
    ])
    return parseDeviceCatalog(types.stdout, runtimes.stdout)
  }

  override async install(request: SimulatorInstallRequest): Promise<SimulatorResolvedTarget> {
    if (!existsSync(request.appPath)) {
      throw new SimulatorError(
        `install target "${request.appPath}" does not exist on this host; pass the path of an existing .app bundle or .ipa archive`,
        'SIMCTL_SUBCOMMAND_FAILED',
      )
    }
    const spec = await this.resolve(request)
    const { devices } = await this.listing(spec)
    const id = resolveSimulatorTarget(devices, request.simulator)
    await this.runVerbSpec(spec, 'install', [String(id), request.appPath])
    return { simulatorId: id }
  }

  override async launch(request: SimulatorLaunchRequest): Promise<SimulatorLaunchResult> {
    const spec = await this.resolve(request)
    const { devices } = await this.listing(spec)
    const id = resolveSimulatorTarget(devices, request.simulator)
    const { stdout } = await this.runVerbSpec(spec, 'launch', [String(id), request.bundleId])
    const observed = parseLaunchOutput(stdout, request.bundleId)
    const launched: SimulatorLaunchResult = { simulatorId: id, bundleId: observed.bundleId }
    // pid / geometry are reported only when actually observed; absence carries
    // its documented note instead of an invented zero.
    if (observed.pid === undefined) {
      launched.geometryNote = GEOMETRY_UNAVAILABLE_NOTE
      return launched
    }
    return { ...launched, pid: observed.pid, geometryNote: GEOMETRY_UNAVAILABLE_NOTE }
  }

  override async terminate(request: SimulatorTerminateRequest): Promise<SimulatorResolvedTarget> {
    const spec = await this.resolve(request)
    const { devices } = await this.listing(spec)
    const id = resolveSimulatorTarget(devices, request.simulator)
    await this.runVerbSpec(spec, 'terminate', [String(id), request.bundleId], 'not found')
    return { simulatorId: id }
  }

  override async screenshot(request: SimulatorScreenshotLikeRequest): Promise<SimulatorScreenshot> {
    const spec = await this.resolve(request)
    const { devices } = await this.listing(spec)
    const id = resolveSimulatorTarget(devices, request.simulator)
    const workDir = await mkdtemp(join(tmpdir(), 'dsh-ios-sim-shot-'))
    try {
      // `simctl io` nests the device BEFORE the io subcommand: io <udid> screenshot <file>.
      const file = join(workDir, 'screen.png')
      await this.runVerbSpec(spec, 'io', [String(id), 'screenshot', '--type=png', file])
      const data = new Uint8Array(await readFile(file))
      const pixels = pngPixelSize(data)
      return { ...pixels, simulatorId: id, mediaType: 'image/png', data }
    } finally {
      await rm(workDir, { recursive: true, force: true })
    }
  }

  override async openUrl(request: SimulatorOpenUrlRequest): Promise<SimulatorResolvedTarget> {
    const spec = await this.resolve(request)
    const { devices } = await this.listing(spec)
    const id = resolveSimulatorTarget(devices, request.simulator)
    await this.runVerbSpec(spec, 'openurl', [String(id), request.url])
    return { simulatorId: id }
  }

  /**
   * One targeted-listing fetch shared by every targeting verb: listing is the
   * substrate's own truth source, so target resolution always runs against a
   * fresh read instead of cached identities.
   */
  private async listing(spec: SimctlInvocationSpec): Promise<{ devices: readonly SimulatorDevice[] }> {
    const { stdout } = await this.runSimctl(spec, ['list'], ['devices', '--json'])
    return { devices: parseDeviceList(stdout) }
  }

  /**
   * Run one allowlisted subcommand for a verb body. Substrate identity rejections
   * matching a tolerated pattern count as success (idempotent state flips);
   * every other nonzero exit becomes `SIMCTL_SUBCOMMAND_FAILED` with the
   * captured stderr tail.
   *
   * @param spec - the resolved plan.
   * @param subcommand - allowlisted subcommand word.
   * @param args - subcommand arguments in substrate order.
   * @param tolerated - lowercase fragments meaning "target already in the requested state".
   * @returns the invocation's stdout for output-parsing verbs.
   */
  private async runVerbSpec(
    spec: SimctlInvocationSpec,
    subcommand: string,
    args: readonly string[],
    ...tolerated: readonly string[]
  ): Promise<{ stdout: string }> {
    if (subcommand === 'io') {
      // Nested form: `io <udid> <verb> …` — the io verb sits at args[1].
      const ioVerb = args[1]
      if (ioVerb === undefined || !IO_ALLOWLIST.has(ioVerb)) {
        throw new SimulatorError(`simctl io ${String(args[1])} is not allowed`, 'SIMCTL_ALLOWLIST_REJECTED')
      }
    }
    const outcome = await this.runSimctl(spec, [subcommand], args)
    if (outcome.exitCode === 0) return { stdout: outcome.stdout }
    const stderrText = outcome.stderr.toLowerCase()
    if (tolerated.some(fragment => stderrText.includes(fragment))) return { stdout: outcome.stdout }
    throw new SimulatorError(
      `simctl ${subcommand} failed (exit ${outcome.exitCode}): ${tail(outcome.stderr)}`,
      'SIMCTL_SUBCOMMAND_FAILED',
    )
  }

  /** Execute one planned `xcrun simctl …` call and collect its facts. The argv chokepoint enforces the subcommand allowlist. */
  protected async runSimctl(spec: SimctlInvocationSpec, prefixTail: readonly string[], restArgs: readonly string[]): Promise<{
    exitCode: number | null
    signal: NodeJS.Signals | null
    stdout: string
    stderr: string
  }> {
    const subcommand = prefixTail[0]
    if (subcommand === undefined || !SIMCTL_ALLOWLIST.has(subcommand)) {
      throw new SimulatorError(`simctl ${String(subcommand)} is not on the dsh-ios-sim-simctl allowlist`, 'SIMCTL_ALLOWLIST_REJECTED')
    }
    const argv = [spec.xcrunPath, 'simctl', ...prefixTail, ...restArgs]
    using fused = deadline(undefined, spec.timeoutMs, TIMEOUT_CODE)
    const handle = this.ctx.subprocess.spawn(this.spawnSpec(argv, spec, fused.signal))
    const outcome = await handle.done
    const timedOut = timeoutOf(fused.signal, TIMEOUT_CODE) !== undefined
    if (timedOut) {
      throw new SimulatorError(
        `simctl ${subcommand} exceeded its ${spec.timeoutMs} ms deadline`,
        TIMEOUT_CODE,
      )
    }
    const collected = SimctlSimulatorProvider.collected(handle)
    return {
      exitCode: outcome.exitCode,
      signal: outcome.signal,
      stdout: collected.stdout.readFrom(0).text,
      stderr: collected.stderr.readFrom(0).text,
    }
  }

  private spawnSpec(argv: readonly string[], spec: SimctlInvocationSpec, signal: AbortSignal): SubprocessSpawnSpec {
    return {
      argv,
      cwd: spec.cwd,
      stdio: { stdin: 'ignore', stdout: { maxBytes: spec.maxOutputBytes }, stderr: { maxBytes: spec.maxOutputBytes } },
      graceMs: this.config.graceMs,
      signal,
    }
  }

  private static collected(handle: SubprocessHandle): { stdout: SubprocessOutputReader; stderr: SubprocessOutputReader } {
    const { stdout, stderr } = handle.collected
    /* v8 ignore start -- both dispositions are requested by construction; defensive. */
    if (stdout === undefined || stderr === undefined) {
      throw new Error('ios-sim-simctl: subprocess implementation dropped a requested collect stream')
    }
    /* v8 ignore stop */
    return { stdout, stderr }
  }
}

/** Level-0 declaration set: everything except the reserved phase seams. */
const PROVIDER_CAPABILITIES: ReadonlySet<SimulatorCapability> = new Set<SimulatorCapability>([
  'list',
  'boot',
  'create',
  'install',
  'launch',
  'terminate',
  'screenshot',
  'openUrl',
])

/** Structural alias kept local: screenshots take the base targeted shape today. */
type SimulatorScreenshotLikeRequest = SimulatorTargetedRequest

/** Substrate text meaning "the device is already booted" (idempotent boot). */
const IDENTITY_BOOTED = 'current state: booted'

/** Substrate text meaning "the device is already off" (idempotent shutdown). */
const IDENTITY_SHUTDOWN = 'current state: shutdown'

/** First line-clamped tail for error messages. */
function tail(text: string, cap = 300): string {
  const line = text.trim().split('\n').pop() ?? ''
  return line.length > cap ? `${line.slice(0, cap)}…` : line
}

export default SimctlSimulatorProvider
