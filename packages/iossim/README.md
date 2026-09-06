---
description: "Package map for the iOS-simulator plane: the capability seam, its simctl and native providers, the model-facing tools, and the browser panel bridge."
kind: "package-group"
---

# iossim/ — iOS-simulator control plane

English | [中文](README.zh.md)

## Summary

The iossim group drives an iOS simulator from the harness: a capability seam declares a closed set of verbs, one provider mounts per composition, and the model-facing tools and the browser panel consume that one seam. Start with the seam and a provider — `ios-sim-simctl` covers `list`/`boot`/`launch`/`screenshot` over the public `xcrun simctl` surface, and `ios-sim-native` adds `describe`, `input`, and a live encoded-video `stream` over the vendored FBSimulatorControl helper. The `tool-ios-sim` package projects the verbs the mounted provider declares into agent tools; `ios-sim-panel` bridges the stream and gestures to a browser tab over a WebSocket. This page maps the group; every package README owns its contract, and the [iOS-simulator subsystem page](../../docs/subsystems/ios-sim.md) is the backend-neutral reference for the seam.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`ios-sim/`](ios-sim/README.md) | Defines the typed `ctx.iosSimulator` seam: the closed capability vocabulary, per-verb gating, and the request/result types every provider and consumer shares | `ctx.iosSimulator` |
| [`ios-sim-simctl/`](ios-sim-simctl/README.md) | Level-0 provider over the public `xcrun simctl` surface: list, boot, install, launch, screenshot, open-url | registers on `ctx.iosSimulator` |
| [`ios-sim-native/`](ios-sim-native/README.md) | Native provider over the FBSimulatorControl helper: the availability tree (`describe`), gestures (`input`), and a live encoded-video handle (`stream`) | registers on `ctx.iosSimulator` |
| [`tool-ios-sim/`](tool-ios-sim/README.md) | Projects the verbs the mounted provider declares into model-facing tools (`sim_list`, `sim_launch`, `sim_screenshot`, `sim_describe`, `sim_input`, …) and the `iosSim/action` record | `ctx.tools` |
| [`ios-sim-panel/`](ios-sim-panel/README.md) | Browser bridge: re-frames the provider's video stream over a WebSocket and forwards panel gestures to the `input` verb | registers a web upgrade route |

-----

<a id="related-documentation"></a>
## Related documentation

- [iOS-simulator subsystem](../../docs/subsystems/ios-sim.md) — the backend-neutral seam contract: the capability vocabulary, per-verb gating, points-or-absence geometry, and the image result card.

<a id="dev-note"></a>
## Dev Note

None.
