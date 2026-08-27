# iOS Simulator

English | [中文](ios-sim.zh.md)

The iOS-simulator seam of [`dsh-ios-sim`](../../packages/iossim/ios-sim): a typed `ctx.iosSimulator` contract with one mounted provider, a closed ten-name capability vocabulary, and per-verb gating that rejects unadvertised verbs with `SIMULATOR_CAPABILITY_UNAVAILABLE`. The level-0 provider is [`dsh-ios-sim-simctl`](../../packages/iossim/ios-sim-simctl) over the public `xcrun simctl` surface through `ctx.subprocess`; model-facing consumers project it as the [`dsh-tool-ios-sim`](../../packages/iossim/tool-ios-sim) tools and the log-only `iosSim/action` event. `describe` and `input` are contract members that reject until a provider implements them — and no provider over the public `simctl` substrate can ever implement them, because `simctl` has no touch injection and no availability-tree read; they require the native provider planned in the [Agent Note](../../.agents/notes/proposed/architecture/2026-08-27-ios-simulator-native-provider.md). `'stream'` is the reserved video-seam name for the same helper.

Source: [`packages/iossim/ios-sim/src/index.ts`](../../packages/iossim/ios-sim/src/index.ts)


<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxiossimulator--iossimulator-abstract-seam"></a>

### `ctx.iosSimulator` — `IosSimulator` (abstract seam)

Abstract iOS-simulator service. Subclass, override the `do*` hooks for every capability you declare, and load the subclass as a plugin — it registers as `ctx.iosSimulator` (one implementation per context; loading a second throws, which is cordis' standard duplicate-service behavior).

Enforced semantics:

- Every public verb first checks capabilities; an unadvertised verb rejects with `SIMULATOR_CAPABILITY_UNAVAILABLE` naming the missing capability and the mounted provider — never a silent no-op and never an empty-answer success.
- The `do*` hooks stay defaulted (also rejecting with the same code), so a provider that advertises a capability without overriding its hooks fails equally loud instead of returning a fake result.
- `boot` and `shutdown` are idempotent power-state flips; a provider treats an already-settled target as success.
- `describe` and `input` reject on every provider until one implements them; their result types are `Promise<never>` deliberately — nothing legitimate can come back yet.

```ts cordis-catalog
/**
 * List devices visible to this provider's substrate, in substrate order.
 * @param request - the caller's request; phase 1 carries no knobs.
 * @returns every device currently listed by the provider's substrate.
 */
async list(request: SimulatorListRequest = {}): Promise<readonly SimulatorDevice[]>

/**
 * Bring the target device to a powered-on state; already-booted targets succeed.
 * @param request - the target reference (omitted = the provider's explicit resolution) with optional deadline knob.
 * @returns the target the provider actually resolved and powered on.
 */
async boot(request: SimulatorBootRequest): Promise<SimulatorResolvedTarget>

/**
 * Power the target device off; already-shutdown targets succeed.
 * @param request - the target reference (omitted = the provider's explicit resolution) with optional deadline knob.
 * @returns the target the provider actually resolved and powered off.
 */
async shutdown(request: SimulatorShutdownRequest): Promise<SimulatorResolvedTarget>

/**
 * Deploy one application bundle onto the target device.
 * @param request - the target reference plus the host path of the application bundle to deploy.
 * @returns the target the provider actually deployed onto.
 */
async install(request: SimulatorInstallRequest): Promise<SimulatorResolvedTarget>

/**
 * Start one installed application and report what the substrate observed.
 * @param request - the target reference and the bundle identifier of an installed app.
 * @returns substrate-observed launch facts: resolved target, bundle, pid when printed, geometry or its note.
 */
async launch(request: SimulatorLaunchRequest): Promise<SimulatorLaunchResult>

/**
 * Stop one running application.
 * @param request - the target reference and the bundle identifier to stop.
 * @returns the target the provider actually resolved.
 */
async terminate(request: SimulatorTerminateRequest): Promise<SimulatorResolvedTarget>

/**
 * Capture the target device's current screen as a complete PNG raster.
 * @param request - the target reference with optional deadline knob.
 * @returns the resolved target plus the complete PNG raster and its pixel facts.
 */
async screenshot(request: SimulatorScreenshotRequest): Promise<SimulatorScreenshot>

/**
 * Open one URL through the target device's URL handler.
 * @param request - the target reference and the absolute URL to open.
 * @returns the target the provider actually resolved.
 */
async openUrl(request: SimulatorOpenUrlRequest): Promise<SimulatorResolvedTarget>

/**
 * Availability-tree read — declared for the phase-2 seam, implemented by no
 * provider yet and unreachable from any provider over the public `simctl`
 * substrate, which has no availability-tree read; only the planned native
 * provider (FBSimulatorControl/FBControlCore helper) can implement it. The
 * `never` result documents that a successful return is impossible today:
 * callers can rely on rejection without feature-testing.
 * @param request - the target reference; payload surface reserved for the availability-tree seam.
 * @returns never resolves today — rejects until a provider implements it.
 */
async describe(request: SimulatorDescribeRequest): Promise<never>

/**
 * Structured input — declared for the phase-2 seam (element references from
 * the availability tree, not screenshot-coordinate taps). Unreachable from
 * any provider over the public `simctl` substrate, which has no touch
 * injection; only the planned native provider can implement it. Rejects on
 * every provider today; see {@link describe}.
 * @param request - the target reference; no coordinate vocabulary by design.
 * @returns never resolves today — rejects until a provider implements it.
 */
async input(request: SimulatorInputRequest): Promise<never>
```

Source: [`packages/iossim/ios-sim/src/index.ts`](../../packages/iossim/ios-sim/src/index.ts)
<!-- END GENERATED cordis-surface -->
