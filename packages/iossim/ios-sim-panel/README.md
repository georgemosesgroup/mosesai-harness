---
description: "WebSocket bridge that streams the native iOS-simulator provider's live video and device inventory to the Web GUI simulator panel over one session-shaped socket."
kind: "package-reference"
---

# dsh-ios-sim-panel

English | [中文](README.zh.md)

<a id="summary"></a>
## Summary

The WebSocket bridge for the [iOS-simulator panel](../../client/ui-simulator/README.md): one upgrade route (`/ios-simulator/stream`) that pumps the mounted [dsh-ios-sim-native](../ios-sim-native/README.md) provider's live stream and device inventory to the Web GUI over one session-shaped socket. JSON control flows browser-to-host (`start`/`stop` with codec, frame-rate, scale, and device knobs); binary video chunks flow host-to-browser verbatim from the provider's `startStream` handle. The `devices` inventory carries each device's substrate `deviceTypeIdentifier` and `runtimeIdentifier` beside its name and state, so the panel can group by model and tell runtimes apart without a second round trip. The route rides the webserver's upgrade registry behind a browser-trust fence (loopback Host + cross-site/Origin checks, extra `trustedHosts` config for LAN GUIs); one stream per socket, stop on close, fenced upgrades get no socket. The surface is GUI-only: chunks and gestures never enter the session log.

Mount it wherever a stream-capable provider and the webServer live (the shipped `dsh --profile web` composition mounts it; a provider that advertises nothing degrades to a loud error frame per start).

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Model Experience

### GUI-only surface

#### What the model sees

Nothing. The bridge is a GUI-only surface: its frames, inventory, and control messages never reach a model request and are not session events. The agent's view of simulators stays the `sim_*` tools.

#### Token effect

Zero. No tool schemas, no prompt text, no session events.

#### KV Cache effect

None. The bridge contributes no model-visible content.

## Known Limitations and Deferred Work

- **Panel gestures are unlogged** — human gestures from the future input surface do not produce `iosSim/action` records (the [native-provider note](../../../.agents/notes/implemented/architecture/2026-08-27-ios-simulator-native-provider.md)'s panel-input decision); the audit-trail event type is deferred to that GUI change ([the panel note](../../../.agents/notes/proposed/architecture/2026-08-27-ios-simulator-panel.md)).
- **The fence is loopback-shaped** — non-loopback GUI hosts must list their authority in `trustedHosts`; there is no per-session token on the upgrade route.

<a id="dev-note"></a>
### Dev Note

None.
