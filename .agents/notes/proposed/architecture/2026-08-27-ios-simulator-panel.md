# Agent Note: iOS simulator panel — the live GUI over the helper stream

Status: proposed


English | [中文](2026-08-27-ios-simulator-panel.zh.md)

## Problem

The harness drives simulators headlessly. The [native-provider note](../../implemented/architecture/2026-08-27-ios-simulator-native-provider.md) shipped the service surface a professional panel needs — a live encoded-video handle (`startStream`: h264/hevc/mjpeg, frame rate, scale), input gestures against element references or device points, and the availability tree — but nothing consumes it visually. A person today watches the device through Apple's Simulator.app (which owns the framebuffer and starves our stream) or through screenshot polling, which the same note rejected as "worse than either a viewer or a stream." The GUI shows tool cards only, and the screenshot card renders metadata, not the raster.

## Proposal

A simulator panel in the Web GUI: a live hardware-decoded view of the device framebuffer with real input, wired through a WebSocket bridge. No screenshots anywhere in the loop.

- **Transport.** The host webserver already registers HTTP upgrade routes; the panel opens one session-authorized WebSocket. Frames flow browser-ward as binary messages (type-1 chunks from the helper verbatim); pointer and keyboard events flow agent-ward as small JSON.
- **Decode.** Primary: WebCodecs `VideoDecoder` on the h264/hevc Annex-B chunks onto a `<canvas>` — hardware decode end to end (helper VideoToolbox encode → browser decode), display-rate rendering, no re-encoding. Fallback: request the stream as MJPEG and render frames directly — works in every browser, lower quality.
- **Input.** Pointer events on the canvas map to device points through the screen size from `sim_describe` (canvas scale × origin), then ride the existing `input` verb: tap, long-press (tap duration), swipe drag, two-finger. Keyboard maps browser keys to HID usage codes; text into fields goes through `text` (accessibility setValue). Hardware buttons (home, siri, volume), lock, shake, and orientation ride HID button/orientation events — new helper `stream`-sibling params, not new ops.
- **Boundaries.** The panel is a GUI-only surface: gestures from it are not logged (per the implemented note's panel-input decision), the agent's transcript is untouched, and no control appears whose only honest value is a label — every control changes observable behavior because each one drives a real verb.

### Milestones

1. **Live view (read-only).** WS bridge + WebCodecs canvas; configured codec/fps/scale; device switch; disconnect-safe stop.
2. **Control.** Pointer→tap/long-press/swipe with coordinate mapping; keyboard usage-code map; hardware buttons, lock, shake, orientation.
3. **Fit and finish.** Two-finger gestures; per-device panel tabs; decode-failure fallback to MJPEG; frame-drop telemetry.

## Alternatives considered

**Screenshot polling.** The implemented note rejected polling as an end state; for a professional panel the latency (seconds), CPU cost, and quality loss disqualify it.

**VNC server.** Hosting a VNC/RFB endpoint in the helper and using a browser VNC client trades a 100-line bridge for a second protocol, an external client dependency, and no access to the accessibility tree.

**Native Swift panel.** A macOS app embedding FBSimulatorControl directly would own the framebuffer with zero transport cost, but it lives outside the harness, cannot reuse the session/attachment/WebGUI plumbing, and duplicates the provider.

**Rendering in the agent transcript.** Frames are not model-visible and must not ride the session log; the transcript shows tool results, not a live surface.

## Acceptance criteria

- The canvas renders the device at the configured frame rate with hardware encode (helper) and hardware decode (browser) — one h264 path verified on Chrome and Safari.
- A pointer tap on the canvas lands at the same device point as an equivalent `sim_input` tap by coordinates.
- Keyboard input types into a focused text field; home/lock/shake/orientation controls produce visible device effects.
- The stream stops cleanly on tab close, provider disposal, and helper supervision restart; no unbounded buffering appears under a stalled consumer.
- Gestures from the panel produce no `iosSim/action` records.

## Risks

Browser decode support for Annex-B H264 varies (Chrome and Safari both ship it; verify with `isConfigSupported` at panel load and fall back to MJPEG). The framebuffer is single-consumer: Simulator.app presenting the device starves the stream — the panel documents it and links the boot-without-host-app path. A stalled WebSocket consumer must drop chunks server-side, not buffer them.
