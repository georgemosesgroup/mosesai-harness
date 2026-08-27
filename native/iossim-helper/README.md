# iossim-helper

English | [中文](README.zh.md)

The native background helper behind the [`dsh-ios-sim-native` provider](../../packages/iossim/ios-sim-native/README.md): a macOS executable with no user interface that links the idb frameworks (FBSimulatorControl, FBControlCore, and their dependency closure, vendored at a pinned commit under `vendor/idb/` per [the vendoring policy](../../vendor/README.md)) and serves what the public `xcrun simctl` surface cannot. It ships exactly one operation today — `describe`, the device availability tree — because one capability is the end-to-end proof of the licence, build, and launch path before any of them carries more ([the owning Agent Note](../../.agents/notes/proposed/architecture/2026-08-27-ios-simulator-native-provider.md)).

The workspace follows the [landlock-run](../landlock-run/README.md) template: a two-layer npm family, one builder of record per architecture, and the binary resolved as a file path, never imported.

## The protocol

A framed request/response JSON exchange over the standard streams. The provider launches the helper with no arguments and speaks first through it.

- **Framing.** Every frame is a 4-byte big-endian length prefix followed by exactly that many bytes of UTF-8 JSON. Frames past 64 MiB are refused.
- **Hello.** The unsolicited first frame on stdout: `{"helper": "iossim-helper", "protocol": 1, "ops": ["describe", "input"]}`. It is the launch proof — the provider waits for it, validates the protocol version, and refuses a helper that announces anything else. A frame without `id` is the hello; every subsequent frame carries an integer `id`.
- **Requests.** `{"id": N, "op": "describe" | "input", "params": …}`. `describe` carries `{"simulatorId": "UDID" | null}`; `input` carries `{"action": …}` with per-gesture payloads — `tap`/`text` need `x`/`y` (text adds `text`), `swipe` needs `xStart`/`yStart`/`xEnd`/`yEnd` and optional `durationMs`, `key` needs a HID `usage` code. An omitted (null) `simulatorId` resolves against the booted devices with the seam's explicit rule: exactly one booted device is required, and zero or several each fail with their own code.
- **Responses.** Success: `{"id": N, "ok": true, "result": …}`. Failure: `{"id": N, "ok": false, "error": {"code": …, "message": …}}` — `code` comes from the simulator seam's failure vocabulary (`SIMULATOR_DEVICE_NOT_FOUND`, `SIMULATOR_TARGET_AMBIGUOUS`, …), so every failure keeps its distinct repair path across the process boundary.
- **describe result.** `{simulatorId, root?, screen?, truncated}` — `root` is the frontmost application's availability tree in the framework's own serialized form (role, label, identifier, frame in points, enabled, children), absent when the read found nothing to report, `screen` the display size in points when attested, `truncated` whether the read was cut short.
- **input result.** `{simulatorId, actedAt?}` — `actedAt` is the device point the gesture landed on (tap/text/swipe-start); a key press reports no point.
- **Diagnostics.** stderr carries free-form text and is never protocol. stdout is protocol and nothing else.
- **Lifecycle.** EOF on stdin means done: the helper drains and exits `0`. Helper-level fatal failures (bad argv, unwritable stdout) exit `70`; a nonzero exit is a dead helper for the provider's supervision. The helper reads no environment variables and accepts no arguments — which binary serves simulator operations is never decidable by ambient state.

## The npm family

- **Entry package** (`@deepseek-ai/iossim-helper`): ESM TypeScript. Owns path resolution (`helperPath`) and the protocol constants, so a provider can never fall behind the binary it launches. Lists every platform package as an `optionalDependency`.
- **Platform packages** (`@deepseek-ai/iossim-helper-darwin-{arm64,x64}`): one prebuilt binary under `bin/`, a `prebuilds.json` declaring it, and no JavaScript. npm's `os`/`cpu` fields select the matching one at install time.

When the platform package is unresolvable, `helperPath()` returns a deterministic path inside the entry package's own `node_modules` that simply never exists; the provider's launch attempt is the single availability signal, exactly like the landlock-run probe posture.

## Build and release model

`node scripts/build.mjs` builds the running architecture: `xcodegen generate` (from `project.yml`, which transcribes the pinned upstream framework targets against `vendor/idb/`), then `xcodebuild` compiles the four static frameworks plus the helper into one self-contained Mach-O binary (all framework targets are static libraries upstream, so nothing ships beside the executable), then installs it at `packages/darwin-<arch>/bin/` and verifies it functionally — a fresh binary must emit a well-formed hello frame and exit cleanly. Xcode is the toolchain of record; there is no cross-toolchain, and CI's per-architecture macOS runners build and prove each binary. Signing is ad-hoc for local development, matching the vendored build configuration.
