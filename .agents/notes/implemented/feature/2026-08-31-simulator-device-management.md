# Agent Note: the native provider serves the full device lifecycle, and the panel manages devices

Status: implemented

English | [中文](2026-08-31-simulator-device-management.zh.md)

## Problem

The simulator seam mounts exactly one provider. The native provider served only `describe`/`input`/`stream`, so a composition that mounted it lost `list`, `boot`, and every other simctl verb — the panel could show only the single already-booted device the helper auto-resolved, and had no way to list the rest, boot a shut-down one, or create a new device when none existed. The seam had no `create` verb at all.

## Decision

`NativeSimulatorProvider` now extends `SimctlSimulatorProvider` instead of `IosSimulator` directly, so it inherits `list`, `boot`, `shutdown`, `launch`, `screenshot`, and `openUrl` — all pure `xcrun simctl` — and adds its helper-backed `describe`/`input`/`stream` on top. One mounted provider covers the whole lifecycle; no composition chooses between simctl and the helper. The base's `resolve()` (a simctl invocation spec) is left untouched; the native helper-spec method is renamed `resolveHelper()` so the two never collide, and `runSimctl` is `protected` so subclasses reuse it. The native config gains simctl's `maxOutputBytes`, and its constructor delegates macOS/xcrun validation to `super`.

The seam grows a `create` capability with two verbs, `create` and `listDeviceTypes`, both gated on `create` (the `shutdown`-rides-`boot` pattern). `create` takes a name plus device-type and runtime identifiers and returns the new device as `list` observes it; `listDeviceTypes` returns the host's device-type and runtime catalog (`simctl list devicetypes -j` / `runtimes -j`), reporting unavailable runtimes rather than dropping them so the panel can grey them out. Both simctl and native advertise `create`.

The panel bridge gains `refresh`, `boot`, `shutdown`, `create`, and `deviceTypes` socket actions; the panel renders every listed device with its power state and a per-row boot/shut-down button, plus a `+ Create` control that opens a name field and device-type/runtime pickers. All copy is in the ru/en/zh dictionaries.

## Alternatives considered

**Mount both providers.** Rejected: the seam mounts exactly one provider by contract, and two would race to own `ctx.iosSimulator`. Inheritance gives one provider the full set without touching that invariant.

**Duplicate the simctl verbs inside native.** Rejected: `list`/`boot`/`create` are the same `xcrun simctl` calls simctl already parses and tests. Extending the class reuses the parser, the developer-dir probe, and the timeout policy instead of copying them.

**A dedicated device-management WebSocket or Remote.** Rejected: the panel bridge already carries typed control JSON both ways with the trust fence and device binding in place; a second channel would duplicate both for no isolation gain.

**Make `listDeviceTypes` part of `list`'s result.** Rejected: the catalog is large (124 device types here) and only the create form needs it; folding it into every `list` would ship it on every panel connect.

## Consequences

The panel lists all devices, boots or shuts one down, and creates a new one from a device type paired with a runtime — verified live against the host (35 devices listed with correct booted/shutdown split, 124 device types and 3 runtimes, a created device raising the count to 36 and confirmed in `simctl`, then booted to `Booted`). The cost: the native provider now requires xcrun at load like simctl does, because it inherits simctl's constructor — correct, since it is macOS-only anyway. `create` is not yet a model-facing tool; only the panel drives it, so it produces no session events.

## Testing

Verified live through the panel bridge on a booted host: `deviceTypes`, full `list`, `create`, and `boot`, each confirmed against `xcrun simctl` directly; the test device was deleted after. `tsc -b` green across the seam, both providers, the bridge, and the panel; host and client bundles rebuilt. No automated coverage yet — the keyless snapshot lane cannot drive a simulator, and a bridge test seam (mock IosSimulator, recorded socket transcript) remains owed, as for the input work.
