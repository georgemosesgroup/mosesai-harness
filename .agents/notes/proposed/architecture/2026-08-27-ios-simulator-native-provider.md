# Agent Note: iOS simulator — the native provider for describe, input, and stream

Status: proposed


English | [中文](2026-08-27-ios-simulator-native-provider.zh.md)

## Problem

The [level-0 seam](../../implemented/architecture/2026-08-27-ios-simulator-seam.md) declares `describe`, `input`, and `stream` as contract members that reject until a provider implements them, and names an idb-class provider as their future home. That note is correct about the destination and silent about what reaching it costs, and the surrounding prose has been read as if the remaining work were another TypeScript package over the same substrate. It is not, and the difference decides whether phase-2 work can start at all.

`xcrun simctl` on a current Xcode exposes no touch injection and no availability-tree read; its `ui` subcommand sets appearance and content size only. No argument, timeout, or parsing effort makes `doDescribe` or `doInput` reachable from `dsh-ios-sim-simctl`: the operations are absent from the substrate, not merely awkward. Any phase-2 branch built on that provider is dead before review, so the plan must say so in the repository rather than in a reviewer's head.

Two further facts shape the replacement. Injecting touch and reading the tree requires linking CoreSimulator through FBSimulatorControl and FBControlCore — the frameworks idb is built on — which means a native, separately built, separately signed executable rather than a workspace package. And a live video stream requires a hardware encoder in that same process, which is why the stream capability cannot be retrofitted onto a screenshot-per-call provider later.

## Proposal

A second provider, `dsh-ios-sim-native`, backed by a native background helper that links FBSimulatorControl, FBControlCore, and VideoToolbox. The helper owns every operation the public CLI cannot perform; the provider is a thin typed client for it. `dsh-ios-sim-simctl` remains the fallback for hosts without the helper, and a composition mounts exactly one provider as today.

Nothing above the provider moves. The capability vocabulary stays closed at ten names, per-verb gating stays the enforcement point, the four `dsh-tool-ios-sim` tools keep their schemas, and `iosSim/action` stays log-only with `SESSION_FORMAT_VERSION` at `0`: richer providers advertise more capabilities and the same gate lets more verbs through. That property is what the level-0 note bought, and this proposal spends it.

### Gate 0 — licence

Answered in writing before any native source lands. FBSimulatorControl and FBControlCore both live in [facebook/idb](https://github.com/facebook/idb) — the standalone repositories no longer exist (`facebook/FBSimulatorControl` redirects there, `facebook/FBControlCore` is gone) — and that repository is [MIT-licensed](https://github.com/facebook/idb/blob/main/LICENSE) (Copyright (c) Meta Platforms, Inc. and affiliates), with no framework-level licence files and no BSD text in the current framework README; the BSD-with-patent-grant wording found in old forks belongs to the retired standalone repository. Redistribution is permitted with the licence text retained, so vendoring is allowed and the fallback paths (a user-installed `idb`, or an XCTest-based route) stay alternatives rather than a triggered switch. The pinned revision is recorded in the [vendor manifest](../../../../vendor/README.md): `main` at `8443cb759e31fb24c2a14aa970a3dc1907bcf1b5` (2026-08-27) for both frameworks.

### Phase 2 — the helper and `describe`

The helper ships as a `native/` workspace beside [`landlock-run`](../../../../native/README.md), reusing its three-package npm family, per-architecture CI build, and release procedure. It is a background executable with no user interface, launched by the provider, speaking a framed request/response protocol over its standard streams.

Phase 2 implements exactly one capability: `describe` returns the availability tree of one device. Element identity, role, label, enabled state, and frame in points come from the framework, not from parsing a raster. Shipping the helper with a single capability is the proof that the licence, build, signing, and launch path all work end to end, before any of them carries more.

Geometry stops being absent at this point. `SimulatorLaunchResult.geometry` fills whenever the native provider serves the call, and the existing `geometryNote` remains the answer under the simctl provider — the points-or-absence rule is satisfied by attestation, exactly as the level-0 note specified.

### Phase 3 — `input` and the interactive panel

`input` performs tap, swipe, key, and text entry, and the request accepts two target forms: an element reference from a preceding `describe`, and a point in device coordinates. The level-0 contract text forbids coordinate tapping because level 0 could not attest the coordinate space; once the helper attests geometry, that prohibition no longer describes a real limit, and a panel where a person clicks the picture has no element reference to offer. Both forms must exist in the request type from the first commit of the verb, because adding the second later would reshape a published tool schema.

Model-issued input is a model-visible action and therefore logs an `iosSim/action` record like every other verb. Panel-issued input from a person is not a model action and must not be logged as one; whether it is logged at all under a distinct type is the one decision phase 3 must settle before its first commit, because it touches the durable log.

The panel becomes an input surface in this phase. Without a stream it repaints from screenshots, so its refresh control stops being cosmetic: a person clicking a stale frame needs the frame to catch up, and the panel must make the lag visible rather than hide it.

### Phase 4 — `stream`

`stream` gains its method and the helper encodes frames through VideoToolbox. Frame rate, resolution scale, and codec become provider configuration with real effect, and the panel's settings become settings of something rather than labels. Until this phase lands, the panel must not present controls whose only honest value is the one they already have. Upstream bounds where the frames can come from: a Simulator presented by the host app (`Simulator.app`, or `DeviceHub.app` from Xcode 27) has its framebuffer consumed by that app's process, unavailable to a process linking FBSimulatorControl, so screen-bearing work boots without the host app — a supported path.

### Process ownership and failure

The helper is one process per installation, not per session, matching how a simulator host behaves: two sessions driving two devices talk to one helper. The provider supervises it — restart on unexpected exit, a bounded retry count, and a distinct error code once the bound is reached, so a dead helper surfaces as a named simulator failure and never as an agent crash. Session teardown must not kill a helper another session is using; helper lifetime is tied to the installation's process, and the [defensive patterns](../../../../docs/defensive-patterns.md) for subprocess ownership apply unchanged.

### Independent of this ladder

`simctl io recordVideo` is public and works today. Screen recording can ship on the existing provider as its own capability-and-tool change, and must not be scheduled behind the helper.

## Alternatives considered

**Extend `dsh-ios-sim-simctl` with `describe` and `input`.** Rejected on evidence: the operations do not exist on the substrate. The subsystem page and package READMEs state this restriction and link this note, because one branch was already started against the earlier simctl-only reading.

**Require a user-installed `idb` binary and shell out to it.** Keeps the harness free of native source and reuses the same frameworks, and remains the fallback if gate 0 forbids vendoring. Rejected as the primary path: it moves a hard dependency onto every user's machine, ties the contract to another project's CLI text output — the parsing coupling the seam exists to avoid — and cannot host a video encoder for phase 4.

**Drive input through XCTest.** Public and Apple-supported, but each interaction is a test-bundle build and run: seconds of latency per tap, a build product to manage, and no tree read outside a test process. Unusable for an interactive panel.

**Coordinate-only input, matching how a person uses a device.** Simpler request type and sufficient for the panel, but it discards the element references `describe` already returns and pushes models back toward reading coordinates off rasters — the habit the level-0 contract text was written to prevent. Both forms cost one union in the request type.

**Element-reference-only input, as the level-0 contract text states.** Rejected once the panel is an input surface: a click on a picture produces a point, and forcing it through a tree lookup makes a person's tap depend on a fresh `describe` that may not match what they are looking at.

**Defer the stream and treat the panel as a viewer indefinitely.** Cheapest, and honest while input does not exist. Rejected as an end state: an input surface whose picture lags is worse than either a viewer or a stream, so phase 3 commits the project to phase 4.

## Acceptance criteria

Gate 0 is answered in writing, with the licence terms and the pinned revision recorded in the vendor manifest, before any native source is committed.

Phase 2 is done when a composition mounting `dsh-ios-sim-native` returns an availability tree for a booted device on both supported architectures; when `unadvertisedCapabilities` proves the provider's advertisement and hooks agree; when `SIMULATOR_CAPABILITY_UNAVAILABLE` still rejects `input` and `stream` on that provider; and when a keyless snapshot through a real runnable example covers a `describe` call, per the [testing policy](../../../../docs/testing.md).

Phase 3 is done when `input` accepts both target forms, when model-issued input appends `iosSim/action`, when the panel-input logging decision is recorded here and implemented, and when killing the helper mid-call produces the named supervision error rather than an unhandled rejection.

Phase 4 is done when frame rate, scale, and codec are validated provider configuration, and when the panel presents no control that does not change observable behavior.

Every phase updates the subsystem page, the affected package READMEs, and both SDK expected outputs in the same change as the code.

## Risks

Gate 0 can fail, and the fallback paths are materially worse: a user-installed `idb` or an XCTest path both lose phase 4. Answering it first is the mitigation.

A native helper adds a build matrix, code signing, and a supervised process to a repository whose runtime is otherwise TypeScript. `landlock-run` proves the shape is affordable here, but it doubles the platform surface that CI must keep green, and a signing or notarization failure blocks the simulator entirely rather than degrading it.

Vendored framework source ages against Xcode releases: CoreSimulator is private and its interfaces move. The simctl provider staying mounted as fallback keeps list, launch, and screenshot working when the helper breaks, which bounds the damage to input and stream.

Phase 3 knowingly widens `input` beyond what the level-0 contract text permits. The prohibition is superseded, not forgotten: it must be rewritten in the contract JSDoc in the same change, or the source will contradict this note.
