# Agent Note: iOS simulator — the native provider for describe, input, and stream

Status: implemented


English | [中文](2026-08-27-ios-simulator-native-provider.zh.md)

## Problem

The [level-0 seam](./2026-08-27-ios-simulator-seam.md) declares `describe`, `input`, and `stream` as contract members that reject until a provider implements them, and names an idb-class provider as their future home. That note is correct about the destination and silent about what reaching it costs, and the surrounding prose has been read as if the remaining work were another TypeScript package over the same substrate. It is not, and the difference decides whether phase-2 work can start at all.

`xcrun simctl` on a current Xcode exposes no touch injection and no availability-tree read; its `ui` subcommand sets appearance and content size only. No argument, timeout, or parsing effort makes `doDescribe` or `doInput` reachable from `dsh-ios-sim-simctl`: the operations are absent from the substrate, not merely awkward. Any phase-2 branch built on that provider is dead before review, so the plan must say so in the repository rather than in a reviewer's head.

Two further facts shape the replacement. Injecting touch and reading the tree requires linking CoreSimulator through FBSimulatorControl and FBControlCore — the frameworks idb is built on — which means a native, separately built, separately signed executable rather than a workspace package. And a live video stream requires a hardware encoder in that same process, which is why the stream capability cannot be retrofitted onto a screenshot-per-call provider later.

## Decision

A second provider, `dsh-ios-sim-native`, backed by a native background helper that links FBSimulatorControl, FBControlCore, and VideoToolbox. The helper owns every operation the public CLI cannot perform; the provider is a thin typed client for it. `dsh-ios-sim-simctl` remains the fallback for hosts without the helper, and a composition mounts exactly one provider as today.

Nothing above the provider moves. The capability vocabulary stays closed at ten names, per-verb gating stays the enforcement point, the four `dsh-tool-ios-sim` tools keep their schemas, and `iosSim/action` stays log-only with `SESSION_FORMAT_VERSION` at `0`: richer providers advertise more capabilities and the same gate lets more verbs through. That property is what the level-0 note bought, and this proposal spends it.

### Gate 0 — licence

Answered in writing before any native source lands. FBSimulatorControl and FBControlCore both live in [facebook/idb](https://github.com/facebook/idb) — the standalone repositories no longer exist (`facebook/FBSimulatorControl` redirects there, `facebook/FBControlCore` is gone) — and that repository is [MIT-licensed](https://github.com/facebook/idb/blob/main/LICENSE) (Copyright (c) Meta Platforms, Inc. and affiliates), with no framework-level licence files and no BSD text in the current framework README; the BSD-with-patent-grant wording found in old forks belongs to the retired standalone repository. Redistribution is permitted with the licence text retained, so vendoring is allowed and the fallback paths (a user-installed `idb`, or an XCTest-based route) stay alternatives rather than a triggered switch. The pinned revision is recorded in the [vendor manifest](../../../../vendor/README.md): `main` at `8443cb759e31fb24c2a14aa970a3dc1907bcf1b5` (2026-08-27) for both frameworks.

### Phase 2 — the helper and `describe` (shipped)

The helper ships as the [`native/iossim-helper`](../../../../native/iossim-helper/README.md) workspace beside [`landlock-run`](../../../../native/README.md), on its two-layer npm-family template: an entry package owning path resolution and protocol constants, plus per-architecture platform packages resolved as file paths, never imported. It is a background executable with no user interface, launched by the provider, speaking a length-prefixed JSON request/response protocol over its standard streams; its hello frame is the launch proof, EOF on stdin means done, and it reads no environment variables. Its framework sources are the pristine idb slice vendored under `vendor/idb/` at the pinned commit, and the build compiles everything into one self-contained Mach-O binary — no frameworks ship beside it.

Phase 2 implements exactly one capability: `describe` returns the availability tree of one device, served by the provider `dsh-ios-sim-native` as a thin typed client that supervises the helper — restart on unexpected exit with a bounded retry count, a named exhaustion code past the bound, a deadline that kills a stuck child, and a teardown that closes stdin and waits. Element role, label, identifier, enabled state, and frame in points come from the framework, not from parsing a raster. Shipping the helper with a single capability is the proof that the licence, build, signing, and launch path all work end to end, before any of them carries more.

Geometry's attestation arrives with the tree. Describe results carry the screen size in points when the read attests it — the availability-tree fact the level-0 note named as geometry's future source — while `SimulatorLaunchResult.geometry` keeps its points-or-absence rule and still fills only when a provider that can attest launch geometry serves the call, which arrives when the helper's capability set grows; under the simctl provider the `geometryNote` remains the answer.

### Phase 3 — `input` and the logging decision (input shipped; the panel surface remains)

`input` performs tap, swipe, key, and text entry, and the request accepts two target forms: an element reference from a preceding `describe`, and a point in device coordinates. The level-0 contract text forbids coordinate tapping because level 0 could not attest the coordinate space; the helper attests geometry, so the prohibition is rewritten in the contract JSDoc in the same change that serves the verb, and both forms exist in the request type from the first commit.

The gesture vocabulary rides two substrate surfaces: tap and swipe go through the helper's HID transports, a key press is an HID usage code, and text entry sets an element's value through the accessibility surface at the resolved point. An element reference resolves against the references the provider minted in its most recent describe (a single-entry cache per provider); a reference that does not resolve rejects with `SIMULATOR_ELEMENT_REFERENCE_STALE`, naming the repair — describe again.

**The panel-input logging decision, settled before the verb's first commit: panel-issued input is not logged.** `iosSim/action` is the model-action vocabulary: its records are emitted by the tool consumer when the model drives a verb, and a person's panel gesture never traverses that consumer, so no action record arises by construction. A panel gesture is not model-visible either — a person did it, not the agent — so the model-visible-implies-logged rule does not reach it. If the GUI panel later wants an audit trail of human gestures, that is a new, distinct event type owned by the panel's own change; `iosSim/action` never carries them.

Model-issued input is a model-visible action and therefore logs an `iosSim/action` record like every other verb: the record carries the gesture family and the target as the audit names it — an element reference or a device point — and never the text a text entry set.

The panel's input affordance — a person clicking the picture, the refresh control making screenshot-driven repaint lag visible — remains the GUI-side piece of this phase; the service and tool surfaces it needs are the ones above.

### Phase 4 — `stream` (shipped)

`stream` gains its method (`startStream`) and the helper encodes frames through VideoToolbox. Frame rate, resolution scale, and codec are provider configuration with real effect — validated at load (`streamCodec`: h264/hevc/mjpeg, `streamFrameRate`, `streamScale`), overridable per request — and the helper pushes encoded chunks as type-1 binary frames while the control path stays open. A slow consumer loses the oldest chunks rather than growing an unbounded buffer: live semantics, not recording. The panel's settings become settings of something rather than labels only when the panel consumes this handle; until that GUI change lands, no stream control is presented that would not change observable behavior.

Upstream bounds where the frames can come from: a Simulator presented by the host app (`Simulator.app`, or `DeviceHub.app` from Xcode 27) has its framebuffer consumed by that app's process, unavailable to a process linking FBSimulatorControl, so screen-bearing work boots without the host app — a supported path.

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


Gate 0 is answered in writing, with the licence terms and the pinned revision recorded in the vendor manifest, before any native source is committed.

Phase 2 is done when a composition mounting `dsh-ios-sim-native` returns an availability tree for a booted device on both supported architectures; when `unadvertisedCapabilities` proves the provider's advertisement and hooks agree; when `SIMULATOR_CAPABILITY_UNAVAILABLE` still rejects `input` and `stream` on that provider; and when a keyless snapshot through a real runnable example covers a `describe` call, per the [testing policy](../../../../docs/testing.md).

Phase 3 is done when `input` accepts both target forms, when model-issued input appends `iosSim/action`, when the panel-input logging decision is recorded here and implemented, and when killing the helper mid-call produces the named supervision error rather than an unhandled rejection.

Phase 4 is done when frame rate, scale, and codec are validated provider configuration, and when the panel presents no control that does not change observable behavior.

Every phase updates the subsystem page, the affected package READMEs, and both SDK expected outputs in the same change as the code.

## Consequences

The seam's ten-name vocabulary is fully served, and the gate that made the level-0 provider honest makes every growth honest the same way: each capability arrived with its own proof surface (describe: the tree; input: the resolved landing point; stream: the encoded chunk flow).

The cost: a native build matrix, ad-hoc code signing, and a supervised process now ride in the repository's runtime; vendored framework sources age against Xcode releases, whose private interfaces move. The simctl provider stays mounted as the fallback for list, launch, and screenshot, bounding the damage of a helper break to the served set. `SESSION_FORMAT_VERSION` stayed at `0` throughout — vocabulary growth, never a structural log change.

## Related

The GUI panel consuming `stream` and `input` is proposed separately: [the simulator-panel note](../../proposed/architecture/2026-08-27-ios-simulator-panel.md).
