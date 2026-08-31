/**
 * Service Definition for the iOS-simulator capability seam (`ctx.iosSimulator`).
 * One provider is mounted per composition; it owns device listing, lifecycle
 * (boot/shutdown), app deployment and launch, screenshots, and URL opening.
 * `describe` and `input` are part of this contract from day one — the phase-2
 * model surface is the device availability tree with stable element
 * references, so the seam must exist before any provider can fill it. No
 * provider over the public `simctl` substrate can ever implement them —
 * `simctl` has no touch injection and no availability-tree read — so they
 * belong to the native provider linking FBSimulatorControl and FBControlCore
 * ([Agent Note](../../../../.agents/notes/implemented/architecture/2026-08-27-ios-simulator-native-provider.md)):
 * `describe` carries its typed availability-tree result from phase 2, `input`
 * its typed gesture result (both target forms) from phase 3, and `stream` its
 * live encoded-video handle (frame rate, scale, and codec as real
 * configuration) from phase 4.
 *
 * Providers that cannot attest a fact leave the result field unset and explain
 * why in the documented note field; they never answer with invented zeros
 * ([explicit > implicit](../../../../AGENTS.md#conventions)).
 *
 * @module @deepseek-ai/dsh-ios-sim
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { CAPABILITY_IMPL_HOOKS, VERB_CAPABILITY } from './capabilities.ts'
import type { SimulatorCapability, SimulatorVerb } from './capabilities.ts'
import { SimulatorError } from './errors.ts'
import type {
  SimulatorBootRequest,
  SimulatorDescribeRequest,
  SimulatorDescribeResult,
  SimulatorDevice,
  SimulatorInputRequest,
  SimulatorInputResult,
  SimulatorStreamHandle,
  SimulatorStreamRequest,
  SimulatorInstallRequest,
  SimulatorLaunchRequest,
  SimulatorLaunchResult,
  SimulatorListRequest,
  SimulatorCreateRequest,
  SimulatorDeviceCatalog,
  SimulatorOpenUrlRequest,
  SimulatorResolvedTarget,
  SimulatorScreenshot,
  SimulatorShutdownRequest,
  SimulatorTargetedRequest,
  SimulatorTerminateRequest,
} from './types.ts'

export { SimulatorId } from './brand.ts'
export { SIMULATOR_CAPABILITIES, VERB_CAPABILITY, CAPABILITY_IMPL_HOOKS } from './capabilities.ts'
export type { SimulatorCapability, SimulatorVerb } from './capabilities.ts'
export { SimulatorError } from './errors.ts'
export { SIMULATOR_ERROR_CODES } from './errors.ts'
export type { SimulatorErrorCode } from './errors.ts'
export type {
  SimulatorAccessibilityElement,
  SimulatorBootRequest,
  SimulatorDescribeRequest,
  SimulatorDescribeResult,
  SimulatorDevice,
  SimulatorElementFrame,
  SimulatorHardwareButton,
  SimulatorInputAction,
  SimulatorInputRequest,
  SimulatorInputResult,
  SimulatorInputTarget,
  SimulatorPoint,
  SimulatorStreamCodec,
  SimulatorStreamHandle,
  SimulatorStreamRequest,
  SimulatorInstallRequest,
  SimulatorLaunchRequest,
  SimulatorLaunchResult,
  SimulatorListRequest,
  SimulatorCreateRequest,
  SimulatorDeviceCatalog,
  SimulatorDeviceType,
  SimulatorRuntime,
  SimulatorOpenUrlRequest,
  SimulatorPointsSize,
  SimulatorResolvedTarget,
  SimulatorScreenshot,
  SimulatorShutdownRequest,
  SimulatorState,
  SimulatorTargetedRequest,
  SimulatorTerminateRequest,
} from './types.ts'

/** Alias so the public `screenshot` verb reads one targeted-request shape without a name collision. */
export type SimulatorScreenshotRequest = SimulatorTargetedRequest

declare module '@deepseek-ai/cordis' {
  interface Context {
    iosSimulator: IosSimulator
  }
}

/**
 * Why a launch result may lack {@link SimulatorLaunchResult.geometry}: the
 * public `simctl` surface exposes no logical point-size fact (verified against
 * current Xcode installs — devicetype/runtime profiles carry no dimensions),
 * so a level-0 provider cannot attest points honestly. Points arrive when a
 * provider reads the device availability tree.
 */
export const GEOMETRY_UNAVAILABLE_NOTE
  = 'device geometry in points is unavailable from the public simctl surface; a provider reading the device availability tree will report it'

/**
 * Abstract iOS-simulator service. Subclass, override the `do*` hooks for every
 * capability you declare, and load the subclass as a plugin — it registers as
 * `ctx.iosSimulator` (one implementation per context; loading a second throws,
 * which is cordis' standard duplicate-service behavior).
 *
 * Enforced semantics:
 * - Every public verb first checks {@link capabilities}; an unadvertised verb
 *   rejects with `SIMULATOR_CAPABILITY_UNAVAILABLE` naming the missing
 *   capability and the mounted provider — never a silent no-op and never an
 *   empty-answer success.
 * - The `do*` hooks stay defaulted (also rejecting with the same code), so a
 *   provider that advertises a capability without overriding its hooks fails
 *   equally loud instead of returning a fake result.
 * - `boot` and `shutdown` are idempotent power-state flips; a provider treats
 *   an already-settled target as success.
 * - `describe`, `input`, and `stream` are served only by providers that
 *   declare them — today the native provider over the FBSimulatorControl
 *   helper — and return typed results: the availability tree, the gesture's
 *   landing point, and a live encoded-video handle; unadvertised verbs reject
 *   through the capability gate like every other verb.
 */
export abstract class IosSimulator extends Service {
  constructor(ctx: Context) {
    super(ctx, 'iosSimulator')
  }

  /** The capability subset this provider implements; stable for the provider's lifetime. */
  abstract get capabilities(): ReadonlySet<SimulatorCapability>

  /** Stable display name of this provider, embedded in unavailability and consistency messages. */
  abstract get providerName(): string

  /**
   * List devices visible to this provider's substrate, in substrate order.
   * @param request - the caller's request; phase 1 carries no knobs.
   * @returns every device currently listed by the provider's substrate.
   */
  async list(request: SimulatorListRequest = {}): Promise<readonly SimulatorDevice[]> {
    this.require('list')
    return this.doList(request)
  }

  /**
   * Bring the target device to a powered-on state; already-booted targets succeed.
   * @param request - the target reference (omitted = the provider's explicit resolution) with optional deadline knob.
   * @returns the target the provider actually resolved and powered on.
   */
  async boot(request: SimulatorBootRequest): Promise<SimulatorResolvedTarget> {
    this.require('boot')
    return this.doBoot(request)
  }

  /**
   * Create a new device from a device type paired with a runtime.
   * @param request - the display name plus the device-type and runtime identifiers.
   * @returns the newly created device as `list` would observe it (shut down).
   */
  async create(request: SimulatorCreateRequest): Promise<SimulatorDevice> {
    this.require('create')
    return this.doCreate(request)
  }

  /**
   * List the device types and runtimes `create` can draw from on this host.
   * @returns the host's device-type and runtime catalog.
   */
  async listDeviceTypes(): Promise<SimulatorDeviceCatalog> {
    this.require('listDeviceTypes')
    return this.doListDeviceTypes()
  }

  /**
   * Power the target device off; already-shutdown targets succeed.
   * @param request - the target reference (omitted = the provider's explicit resolution) with optional deadline knob.
   * @returns the target the provider actually resolved and powered off.
   */
  async shutdown(request: SimulatorShutdownRequest): Promise<SimulatorResolvedTarget> {
    this.require('boot')
    return this.doShutdown(request)
  }

  /**
   * Deploy one application bundle onto the target device.
   * @param request - the target reference plus the host path of the application bundle to deploy.
   * @returns the target the provider actually deployed onto.
   */
  async install(request: SimulatorInstallRequest): Promise<SimulatorResolvedTarget> {
    this.require('install')
    return this.doInstall(request)
  }

  /**
   * Start one installed application and report what the substrate observed.
   * @param request - the target reference and the bundle identifier of an installed app.
   * @returns substrate-observed launch facts: resolved target, bundle, pid when printed, geometry or its note.
   */
  async launch(request: SimulatorLaunchRequest): Promise<SimulatorLaunchResult> {
    this.require('launch')
    return this.doLaunch(request)
  }

  /**
   * Stop one running application.
   * @param request - the target reference and the bundle identifier to stop.
   * @returns the target the provider actually resolved.
   */
  async terminate(request: SimulatorTerminateRequest): Promise<SimulatorResolvedTarget> {
    this.require('terminate')
    return this.doTerminate(request)
  }

  /**
   * Capture the target device's current screen as a complete PNG raster.
   * @param request - the target reference with optional deadline knob.
   * @returns the resolved target plus the complete PNG raster and its pixel facts.
   */
  async screenshot(request: SimulatorScreenshotRequest): Promise<SimulatorScreenshot> {
    this.require('screenshot')
    return this.doScreenshot(request)
  }

  /**
   * Open one URL through the target device's URL handler.
   * @param request - the target reference and the absolute URL to open.
   * @returns the target the provider actually resolved.
   */
  async openUrl(request: SimulatorOpenUrlRequest): Promise<SimulatorResolvedTarget> {
    this.require('openUrl')
    return this.doOpenUrl(request)
  }

  /**
   * Availability-tree read — the device's accessibility tree with stable
   * element references, served by providers that declare the `describe`
   * capability (today the native provider over the FBSimulatorControl
   * helper). A provider that does not declare it rejects through the
   * capability gate, so callers can rely on a loud error without
   * feature-testing.
   * @param request - the target reference; the explicit target-resolution step fills omissions.
   * @returns the availability tree of the resolved device, with the facts the read observed.
   */
  async describe(request: SimulatorDescribeRequest): Promise<SimulatorDescribeResult> {
    this.require('describe')
    return this.doDescribe(request)
  }

  /**
   * Structured input — one gesture (tap, swipe, key, text entry) against one
   * device, served by providers that declare the `input` capability (today
   * the native provider over the FBSimulatorControl helper's HID and
   * accessibility surfaces). The level-0 text forbade coordinate targets
   * because level 0 could not attest the coordinate space; the helper attests
   * geometry, so both target forms exist — an element reference from a
   * preceding `describe`, or a point in device coordinates. A provider that
   * does not declare the capability rejects through the gate like every other
   * verb.
   * @param request - the gesture: its action discriminator, its target, and the action's payload.
   * @returns the resolved target plus the point the gesture landed on, when one exists.
   */
  async input(request: SimulatorInputRequest): Promise<SimulatorInputResult> {
    this.require('input')
    return this.doInput(request)
  }

  protected doList(_request: SimulatorListRequest): Promise<readonly SimulatorDevice[]> {
    return this.unimplemented('list')
  }

  protected doBoot(_request: SimulatorBootRequest): Promise<SimulatorResolvedTarget> {
    return this.unimplemented('boot')
  }

  protected doShutdown(_request: SimulatorShutdownRequest): Promise<SimulatorResolvedTarget> {
    return this.unimplemented('shutdown')
  }

  protected doCreate(_request: SimulatorCreateRequest): Promise<SimulatorDevice> {
    return this.unimplemented('create')
  }

  protected doListDeviceTypes(): Promise<SimulatorDeviceCatalog> {
    return this.unimplemented('listDeviceTypes')
  }

  protected doInstall(_request: SimulatorInstallRequest): Promise<SimulatorResolvedTarget> {
    return this.unimplemented('install')
  }

  protected doLaunch(_request: SimulatorLaunchRequest): Promise<SimulatorLaunchResult> {
    return this.unimplemented('launch')
  }

  protected doTerminate(_request: SimulatorTerminateRequest): Promise<SimulatorResolvedTarget> {
    return this.unimplemented('terminate')
  }

  protected doScreenshot(_request: SimulatorScreenshotRequest): Promise<SimulatorScreenshot> {
    return this.unimplemented('screenshot')
  }

  protected doOpenUrl(_request: SimulatorOpenUrlRequest): Promise<SimulatorResolvedTarget> {
    return this.unimplemented('openUrl')
  }

  protected doDescribe(_request: SimulatorDescribeRequest): Promise<SimulatorDescribeResult> {
    return this.unimplemented('describe')
  }

  protected doInput(_request: SimulatorInputRequest): Promise<SimulatorInputResult> {
    return this.unimplemented('input')
  }

  /**
   * Live video stream — encoded frames straight from the substrate's
   * framebuffer, served by providers that declare the `stream` capability
   * (today the native provider over the helper's VideoToolbox path). Frame
   * rate, scale, and codec come from the request and the provider's
   * configuration, with the substrate clamping what it cannot honor exactly.
   * A provider that does not declare the capability rejects through the gate.
   * @param request - the stream knobs (codec, frame rate, scale); omissions take the provider's configuration.
   * @returns a handle whose `frames` iterable yields encoded chunks until `stop`.
   */
  async startStream(request: SimulatorStreamRequest = {}): Promise<SimulatorStreamHandle> {
    this.require('stream')
    return this.doStreamStart(request)
  }

  protected doStreamStart(_request: SimulatorStreamRequest): Promise<SimulatorStreamHandle> {
    return this.unimplemented('stream')
  }

  /** Reject unless the provider declared the verb's gating capability. */
  private require(verb: SimulatorVerb): void {
    const capability = VERB_CAPABILITY[verb]
    if (this.capabilities.has(capability)) return
    throw new SimulatorError(
      `the mounted simulator provider "${this.providerName}" does not declare the "${capability}" `
        + `capability, so "${verb}" cannot run; mount a provider that declares "${capability}" to enable it `
        + '(ctx.iosSimulator mounts exactly one provider)',
      'SIMULATOR_CAPABILITY_UNAVAILABLE',
    )
  }

  /** Reject for an advertised capability whose hooks were never overridden — a broken provider, not a caller error. */
  private unimplemented(verb: SimulatorVerb): never {
    const capability = VERB_CAPABILITY[verb]
    throw new SimulatorError(
      `the simulator provider "${this.providerName}" declares the "${capability}" capability but did not `
        + `override its implementation hook, so "${verb}" cannot run; this is a broken provider build, `
        + 'not a caller-recoverable state',
      'SIMULATOR_CAPABILITY_UNAVAILABLE',
    )
  }
}

/**
 * Declared capabilities whose implementation hooks are still the Service
 * Definition's rejecting defaults — the advertisement↔override consistency
 * breach every provider must prove absent ([package invariant
 * rules](../../../../packages/AGENTS.md)).
 * @param provider - a mounted provider instance.
 * @returns capability names that are advertised but not actually implemented; empty means consistent.
 */
export function unadvertisedCapabilities(provider: IosSimulator): readonly SimulatorCapability[] {
  const base = IosSimulator.prototype as unknown as Record<string, unknown>
  const self = provider as unknown as Record<string, unknown>
  const missing = new Set<SimulatorCapability>()
  for (const capability of provider.capabilities) {
    for (const hook of CAPABILITY_IMPL_HOOKS[capability]) {
      const impl = self[hook]
      if (typeof impl !== 'function' || impl === base[hook]) missing.add(capability)
    }
  }
  return [...missing]
}

export default IosSimulator
