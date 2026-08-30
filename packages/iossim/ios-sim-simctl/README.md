---
description: "Level-0 iOS-simulator Service Provider over the public xcrun simctl surface, spawning strict allowlisted argv through the subprocess seam with no idb, accessibility trees, or video."
kind: "package-reference"
---

# dsh-ios-sim-simctl

English | [中文](README.zh.md)

<a id="summary"></a>
## Summary

Level-0 Service Provider for the iOS-simulator seam over the PUBLIC `xcrun simctl` surface — no idb, no accessibility trees, no video. Everything spawns through [`ctx.subprocess`](../../subprocess/subprocess/README.md) as strict argv arrays; the subcommand word passes the fixed `SIMCTL_ALLOWLIST` (`list, boot, shutdown, install, launch, terminate, openurl, io`), and arguments beyond it come only from typed request fields, never interpolated caller text ([dif-explorer git-run precedent](../../host/dif-explorer/src/gitrun.ts)).

Distinct failures, distinct repairs:

| Situation | Code | Hint shape |
|---|---|---|
| No Xcode selection / wrong layout | `SIMULATOR_XCODE_NOT_RESOLVED` | install Xcode; re-select with `sudo xcode-select -s …` |
| `xcrun` unreachable in this execution world | `SIMULATOR_XCODE_NOT_RESOLVED` | command-line tools / composition subprocess world |
| Xcode present without iPhoneOS.platform | `SIMULATOR_IOS_SDK_MISSING` | install the iOS platform component |
| Unknown device id | `SIMULATOR_DEVICE_NOT_FOUND` | call the listing verb, use ids verbatim |
| Auto-target with nothing booted | `SIMULATOR_DEVICE_NOT_BOOTED` | boot a simulator first |
| Auto-target with several booted | `SIMULATOR_TARGET_AMBIGUOUS` | name one explicitly |
| Nonzero simctl exit | `SIMCTL_SUBCOMMAND_FAILED` | stderr tail |
| Allowlist miss | `SIMCTL_ALLOWLIST_REJECTED` | fixed vocabulary only |
| Deadline exceeded | `SIMCTL_TIMEOUT` | configured budget |

Explicit defaults: every substrate call goes through public `resolve(request): SimctlInvocationSpec`, which fills launcher path, validated developer dir (`xcode-select -p`, probed once and memoized), deadline clamping (`timeoutMs` default/cap config, timer-bounded), capture budgets, and working directory — verb bodies never apply hidden fallbacks ([dsh-shell template](../../shell/shell/src/index.ts)). Target resolution follows the same rule: an omitted reference requires exactly ONE booted device via exported `resolveSimulatorTarget`; each mismatch is its own code above.

Load-time loudness: constructing on non-macOS throws `SIMULATOR_PLATFORM_UNSUPPORTED`, so a misconfigured composition fails at load instead of sitting idle.

Declared capabilities: `list, boot (incl. shutdown), install, launch, terminate, screenshot, openUrl`. NOT declared: `describe`, `input`, `stream` — the future seams.

Geometry honesty: screenshots are native rasters; the public surface exposes no point-size query (verified against current installs — profile plists carry no display dimensions). Launch results therefore carry `GEOMETRY_UNAVAILABLE_NOTE`, never guessed points.

## Table of Contents

- [Config](#config)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="config"></a>
## Config

| field | default | meaning |
|---|---|---|
| `timeoutMs` | 60000 | per-invocation deadline |
| `maxTimeoutMs` | 600000 | upper clamp |
| `maxOutputBytes` | 64000 | per-stream stdout/stderr cap |
| `graceMs` | 3000 | SIGTERM→SIGKILL escalation |

## Model Experience

Indirectly, through `dsh-tool-ios-sim`, which projects the verbs this provider serves over the simulator seam.

#### KV Cache effect

None; nothing here participates in request assembly or history retention.

## Known Limitations and Deferred Work

- **No point geometry from any verb** — the level-0 surface cannot attest logical sizes; points arrive with the planned [native provider](../../../.agents/notes/implemented/architecture/2026-08-27-ios-simulator-native-provider.md), which reads the availability tree — the public `simctl` substrate has no availability-tree read and no touch injection, so this provider can never serve `describe` or `input`.
- **State staleness between calls** — another actor can boot/shutdown/erase a device right after a listing; verbs resolve targets against a FRESH listing each time precisely so stale answers fail loudly with their own codes.
- **No app deployment convenience** — `install` requires an existing .app/.ipa path; no download/build helpers here.

<a id="dev-note"></a>
### Dev Note

None.
