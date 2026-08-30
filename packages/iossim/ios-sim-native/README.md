---
description: "Native iOS-simulator Service Provider over the iossim-helper background process, serving the describe, input, and stream capabilities the public simctl surface cannot."
kind: "package-reference"
---

# dsh-ios-sim-native

English | [中文](README.zh.md)

<a id="summary"></a>
## Summary

Native Service Provider for the iOS-simulator seam over the [`iossim-helper`](../../../native/iossim-helper/README.md) background helper, which links Meta's FBSimulatorControl and FBControlCore (MIT, pinned and source-vendored per [the vendoring policy](../../../vendor/README.md)) and serves what the public `xcrun simctl` surface structurally cannot. Phase 2 shipped **exactly one capability — `describe`**, the device availability tree with stable element references, as the end-to-end proof of the licence, build, and launch path; phase 3 grew the set with **`input`** — tap, swipe, key, and text entry, against either an element reference or a device point — and phase 4 with **`stream`** — a live encoded-video handle with frame rate, scale, and codec as real configuration ([the owning Agent Note](../../../.agents/notes/implemented/architecture/2026-08-27-ios-simulator-native-provider.md)). Every other public verb rejects with `SIMULATOR_CAPABILITY_UNAVAILABLE`.

Distinct failures, distinct repairs:

| Situation | Code | Hint shape |
|---|---|---|
| Non-macOS host | `SIMULATOR_PLATFORM_UNSUPPORTED` | mount this provider on macOS only |
| Helper missing / spawn failed / exited | `SIMULATOR_HELPER_UNAVAILABLE` | install the `@deepseek-ai/iossim-helper` platform package or set `helperPath` |
| Hello frame wrong / framing broken | `SIMULATOR_HELPER_PROTOCOL_BROKEN` | the binary and the entry package version together — mixed install |
| Restarts exhausted | `SIMULATOR_HELPER_SUPERVISION_EXHAUSTED` | check the helper installation, then remount |
| Helper-request deadline | `SIMULATOR_HELPER_TIMEOUT` | configured budget |
| Substrate refusal (target resolution, read failure) | the helper's own seam code | message carries the repair |

## Table of Contents

- [Config](#config)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="config"></a>
## Config

| field | default | meaning |
|---|---|---|
| `helperPath` | entry-package resolution | explicit helper binary path — the test-injection and custom-install escape hatch; the runtime itself reads no environment |
| `timeoutMs` | 60000 | per-helper-request deadline |
| `maxTimeoutMs` | 600000 | upper clamp |
| `maxRestarts` | 3 | supervised restarts before the named exhaustion failure (cumulative per provider instance) |
| `graceMs` | 3000 | SIGTERM→SIGKILL escalation on teardown |
| `streamCodec` | `h264` | Live-stream codec: `h264`, `hevc`, or `mjpeg` |
| `streamFrameRate` | 30 | Live-stream frame-rate cap |
| `streamScale` | 1 | Live-stream resolution scale, `1` = native |

Target resolution runs INSIDE the helper, which owns the CoreSimulator device-set binding: an omitted reference requires exactly ONE booted device there, and zero or several each fail with the seam's own codes (`SIMULATOR_DEVICE_NOT_BOOTED`, `SIMULATOR_TARGET_AMBIGUOUS`). The provider's explicit `resolve(request): NativeInvocationSpec` plans helper path, deadline, and restart bound — verb bodies carry no hidden fallbacks ([dsh-shell template](../../shell/shell/src/index.ts)).

Load-time loudness: constructing on non-macOS throws `SIMULATOR_PLATFORM_UNSUPPORTED`, so a misconfigured composition fails at load instead of sitting idle. Teardown is awaited: the provider's disposal closes the helper's stdin (the protocol's EOF-means-done), waits for a clean exit, and escalates to tree termination only if the child ignores the close ([defensive patterns](../../../docs/defensive-patterns.md)).

## Model Experience

### No model-facing surface yet

#### What the model sees

Nothing today: none of the four phase-1 tools route to this provider — unadvertised verbs gate loud — so this provider's model-visible surface arrives with a `describe` consumer. Service-level consumers get the availability tree: element role, label, substrate identifier, frame in POINTS, enabled state, and the index-path `reference` fields a later `input` call will name.

#### Token effect

The describe result scales with the frontmost application's element count; large trees need consumer-side pruning or key narrowing before reaching a model context. Errors are one-line, repair-named messages.

#### KV Cache effect

Nothing on its own: the provider appends no session events, so it never grows a transcript by itself; consumer projections own whatever they log.

## Known Limitations and Deferred Work

- **Still no list/boot surface** — `list`, `boot`, and the rest stay with [`dsh-ios-sim-simctl`](../ios-sim-simctl/README.md); compositions mount the simctl provider for those and the native provider for input-class work until the helper's capability set grows further.
- **Element references are per-read** — the framework names no stable cross-read identity, so references are index paths valid within one describe result; a re-describe repaginates a live UI, and a reference that no longer resolves rejects with `SIMULATOR_ELEMENT_REFERENCE_STALE`.
- **Live stream needs the framebuffer** — a Simulator presented by the host app (`Simulator.app`, or `DeviceHub.app` from Xcode 27) consumes its framebuffer; screen-bearing work boots without the host app (a supported boot path).
- **macOS only, Xcode required** — the helper links Apple's private CoreSimulator/SimulatorKit from the selected Xcode; a host without Xcode cannot run this provider (the simctl fallback degrades loudly for its own verbs).

<a id="dev-note"></a>
### Dev Note

None.
