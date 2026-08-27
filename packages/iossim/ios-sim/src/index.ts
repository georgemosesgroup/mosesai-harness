/**
 * Service Definition for the iOS-simulator capability seam (`ctx.iosSimulator`).
 * One provider is mounted per composition; it owns device listing, lifecycle
 * (boot/shutdown), app deployment and launch, screenshots, and URL opening.
 * `describe` and `input` are part of this contract from day one — the phase-2
 * model surface is the device availability tree with stable element
 * references, so the seam must exist before any provider can fill it — while
 * `'stream'` stays a reserved capability name for the future video surface.
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
  SimulatorDevice,
  SimulatorInputRequest,
  SimulatorInstallRequest,
  SimulatorLaunchRequest,
  SimulatorLaunchResult,
  SimulatorListRequest,
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
export type { SimulatorErrorCode } from './errors.ts'
export type {
  SimulatorBootRequest,
  SimulatorDescribeRequest,
  SimulatorDevice,
  SimulatorInputRequest,
  SimulatorInstallRequest,
  SimulatorLaunchRequest,
  SimulatorLaunchResult,
  SimulatorListRequest,
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
 * - `describe` and `input` reject on every provider until one implements them;
 *   their result types are `Promise<never>` deliberately — nothing legitimate
 *   can come back yet.
 */
export abstract class IosSimulator extends Service {
  constructor(ctx: Context) {
    super(ctx, 'iosSimulator')
  }

  /** The capability subset this provider implements; stable for the provider's lifetime. */
  abstract get capabilities(): ReadonlySet<SimulatorCapability>

  /** Stable display name of this provider, embedded in unavailability and consistency messages. */
  abstract get providerName(): string

  /** List devices visible to this provider's substrate, in substrate order. */
  async list(request: SimulatorListRequest = {}): Promise<readonly SimulatorDevice[]> {
    this.require('list')
    return this.doList(request)
  }

  /** Bring the target device to a powered-on state; already-booted targets succeed. */
  async boot(request: SimulatorBootRequest): Promise<SimulatorResolvedTarget> {
    this.require('boot')
    return this.doBoot(request)
  }

  /** Power the target device off; already-shutdown targets succeed. */
  async shutdown(request: SimulatorShutdownRequest): Promise<SimulatorResolvedTarget> {
    this.require('boot')
    return this.doShutdown(request)
  }

  /** Deploy one application bundle onto the target device. */
  async install(request: SimulatorInstallRequest): Promise<SimulatorResolvedTarget> {
    this.require('install')
    return this.doInstall(request)
  }

  /** Start one installed application and report what the substrate observed. */
  async launch(request: SimulatorLaunchRequest): Promise<SimulatorLaunchResult> {
    this.require('launch')
    return this.doLaunch(request)
  }

  /** Stop one running application. */
  async terminate(request: SimulatorTerminateRequest): Promise<SimulatorResolvedTarget> {
    this.require('terminate')
    return this.doTerminate(request)
  }

  /** Capture the target device's current screen as a complete PNG raster. */
  async screenshot(request: SimulatorScreenshotRequest): Promise<SimulatorScreenshot> {
    this.require('screenshot')
    return this.doScreenshot(request)
  }

  /** Open one URL through the target device's URL handler. */
  async openUrl(request: SimulatorOpenUrlRequest): Promise<SimulatorResolvedTarget> {
    this.require('openUrl')
    return this.doOpenUrl(request)
  }

  /**
   * Availability-tree read — declared for the phase-2 seam, implemented by no
   * provider yet. The `never` result documents that a successful return is
   * impossible today: callers can rely on rejection without feature-testing.
   */
  async describe(request: SimulatorDescribeRequest): Promise<never> {
    this.require('describe')
    return this.doDescribe(request)
  }

  /**
   * Structured input — declared for the phase-2 seam (element references from
   * the availability tree, not screenshot-coordinate taps). Rejects on every
   * provider today; see {@link describe}.
   */
  async input(request: SimulatorInputRequest): Promise<never> {
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

  protected doDescribe(_request: SimulatorDescribeRequest): Promise<never> {
    return this.unimplemented('describe')
  }

  protected doInput(_request: SimulatorInputRequest): Promise<never> {
    return this.unimplemented('input')
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
