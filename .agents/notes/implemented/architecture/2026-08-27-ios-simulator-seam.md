# Agent Note: iOS-simulator seam — level-0 vocabulary, points-or-absence geometry, and the image result card

Status: implemented


English | [中文](2026-08-27-ios-simulator-seam.zh.md)

## Problem

iOS simulators are the first host surface the harness drives that is neither a filesystem nor a web endpoint: the substrate is `xcrun simctl`, whose public surface can list/boot/install/launch/screenshot/openurl but cannot tap or describe UI trees. A phase plan exists where later phases add idb-backed input and a video stream. If the contract were sketched only from what level-0 can do, two failure modes were locked in before they existed: the session-event and render-intent vocabularies would need redesign when richer providers arrived, and consumers would grow screenshot-coordinate habits exactly opposite to the planned element-reference interface.

Three concrete questions had to be settled in one PR — the model-visible event (`iosSim/action`), what `sim_launch` reports about device geometry, and which render intent a screenshot card carries — because each touches a closed union or durable log shape shared far beyond the new packages.

## Decision

**A three-package seam with enforced gating.** `dsh-ios-sim` owns the typed contract and a CLOSED ten-name capability set (`list, boot, install, launch, terminate, screenshot, openUrl, describe, input, stream`). Every verb consults the provider's declared subset BEFORE doing work and rejects with `SIMULATOR_CAPABILITY_UNAVAILABLE`, naming the missing capability, the verb, and the provider's own name; the `do*` hooks stay defaulted with the same rejection so "advertised but not implemented" fails equally loud (`unadvertisedCapabilities` gives every provider suite its consistency proof). Two deliberate mismatches between verbs and capabilities are logged here once: `shutdown` rides `'boot'` (one power-state ability), and `'stream'` has no method yet (reserved name). This is the [capability-seam](2026-06-13-capability-seams.md) roles split applied without exceptions.

**Contract-first future seams as rejecting members.** `describe(input)` return `Promise<never>` today: callers cannot even type a legitimate success out of them. Declaring them now costs nothing at runtime but keeps the phase-2 surface element-reference-shaped — the contract text explicitly forbids coordinate tapping on screenshots — instead of reshaping both SDK projections after release.

**Geometry is points-or-absence, never derived.** Verified against current Xcode installs: the public simctl surface exposes no point-size query, profile plists carry no display dimensions, and screenshot rasters are native pixels with no public scale fact. So `SimulatorLaunchResult.geometry` fills only when a provider CAN attest it; otherwise the documented `geometryNote` names the availability tree as the future source. A curated identifier→points table was rejected as silently stale data riding into model diagnostics.

**The `image` render intent joins the closed union.** The completed `sim_screenshot` card becomes `{ card: 'image', origin?, attachmentId, mediaType, bytes, width, height }` in `dsh-tools/presentation`: flat scalars mirror the serialized `ImageAttachmentRef` (the WebSource precedent — core cannot import the attachment seam), GUIs load rasters through their existing session attachment route, replay rebuilds the identical view from persisted `output.presentationMeta`, and unknown-card fallback stays the wire convention. `generic`/`terminal` are semantically wrong for an image payload, and a schema-less pocket inside content blocks is exactly the drift this union exists to prevent.

**Ordinary vocabulary growth, no version bump.** `iosSim/action` is log-only (derived history ignores it), emitted through the same `session.append` path as `todo/write`; `KNOWN_SESSION_EVENT_TYPES` regenerates in-repo via `gen-persistence-catalog`, and `SESSION_FORMAT_VERSION` stays `0` per the [version mechanism](2026-08-10-session-log-version-mechanism.md).

## Consequences

Level-0 provides real control TODAY with loud failures instead of pretending: distinct codes separate "fix xcode-select", "install the iOS platform", and "boot/name a device"; non-macOS compositions refuse to load the provider outright. Consumers see screenshots as first-class images (durable commit BEFORE any log write; base64 never rides events), and the audit trail answers who-did-what-to-which-device. The GUI shows metadata cards for now — pane-side raster loading waits on a session-authorized loader reaching tool surfaces, tracked as Known Limitations rather than half-plumbed. Phase-2/4 work must extend capability vocabulary IN-REPO (out-of-repo extension deferred), implement `doDescribe`/`doInput` against an idb-class provider, and may then replace `Promise<never>` bodies with typed payloads; nothing else about the seam needs redesign.

## Alternatives considered

- **Capability probe at consumer time** ("call and catch") — keeps enforcement out of the operation and turns misconfiguration into retry loops; rejected per [enforce-at-the-operation](../../../../docs/cookbook/adding-a-tool.md).
- **Optional `?? default` target resolution inside verbs** — hidden defaults; resolved by exporting `resolveSimulatorTarget` (fresh listing, three failure codes) as the ONLY defaulting step.
- **Curated device-size table** — satisfies "returns geometry" literally while shipping wrong numbers to models whenever Apple ships a device; rejected for evidence-first reasons.
- **Reuse `generic` card with an image content block** — today's generic renderer stringifies image blocks into JSON noise, proving the render intent is genuinely new information for the wire, not cosmetics.
