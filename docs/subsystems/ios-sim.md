# iOS Simulator

English | [中文](ios-sim.zh.md)

The iOS-simulator seam of [`dsh-ios-sim`](../../packages/iossim/ios-sim): a typed `ctx.iosSimulator` contract with one mounted provider, a closed ten-name capability vocabulary, and per-verb gating that rejects unadvertised verbs with `SIMULATOR_CAPABILITY_UNAVAILABLE`. The level-0 provider is [`dsh-ios-sim-simctl`](../../packages/iossim/ios-sim-simctl) over the public `xcrun simctl` surface through `ctx.subprocess`; model-facing consumers project it as the [`dsh-tool-ios-sim`](../../packages/iossim/tool-ios-sim) tools and the log-only `iosSim/action` event. No provider over the public `simctl` substrate can ever implement `describe` or `input` — `simctl` has no touch injection and no availability-tree read — so they belong to the native provider [`dsh-ios-sim-native`](../../packages/iossim/ios-sim-native): a thin client over the [iossim-helper](../../native/iossim-helper/README.md) executable linking FBSimulatorControl and FBControlCore (pinned per [the vendoring policy](../../vendor/README.md)). `describe` is served from phase 2 and returns the availability tree typed below; `input` is served from phase 3 and performs one gesture — tap, swipe, key, text entry — whose target is either an element reference a preceding `describe` minted or a point in device coordinates (the level-0 prohibition on coordinate targets was written when no provider could attest the coordinate space; it is superseded, not forgotten). `'stream'` is the reserved video-seam name for the same helper ([Agent Note](../../.agents/notes/proposed/architecture/2026-08-27-ios-simulator-native-provider.md)).

The availability-tree vocabulary: a `SimulatorDescribeResult` carries the frontmost application's root `SimulatorAccessibilityElement` — role, label, substrate identifier, frame in points, enabled state, and the provider-minted index-path `reference` that the input verb's element-target form will name — plus the attested screen size in points when the read provides it. References are valid within one result; a re-describe repaginates a live UI, and an element-target input against a stale reference rejects with `SIMULATOR_ELEMENT_REFERENCE_STALE` naming the repair. An `SimulatorInputResult` reports the device point the gesture landed on: an element reference resolves to its frame's centre, a point target passes through, a swipe reports its start, and a key press reports no point at all.

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
- `describe` and `input` are served only by providers that declare them — today the native provider over the FBSimulatorControl helper — and return typed results: the availability tree, and the gesture's landing point; unadvertised verbs reject through the capability gate like every other verb.

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
 * Availability-tree read — the device's accessibility tree with stable
 * element references, served by providers that declare the `describe`
 * capability (today the native provider over the FBSimulatorControl
 * helper). A provider that does not declare it rejects through the
 * capability gate, so callers can rely on a loud error without
 * feature-testing.
 * @param request - the target reference; the explicit target-resolution step fills omissions.
 * @returns the availability tree of the resolved device, with the facts the read observed.
 */
async describe(request: SimulatorDescribeRequest): Promise<SimulatorDescribeResult>

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
async input(request: SimulatorInputRequest): Promise<SimulatorInputResult>
```

Source: [`packages/iossim/ios-sim/src/index.ts`](../../packages/iossim/ios-sim/src/index.ts)
<!-- END GENERATED cordis-surface -->
