---
description: "Simulator panel tab in the Web GUI — a live iOS-simulator framebuffer with tap/swipe/keyboard/button input over the ios-sim-panel WebSocket bridge — plus the keyed sim_screenshot tool row; for maintainers of the simulator surface."
kind: "package-reference"
---

# dsh-client-ui-simulator

English | [中文](README.zh.md)

<a id="summary"></a>
## Summary

The simulator panel tab in the Web GUI: a live view of one iOS simulator's framebuffer over the [ios-sim-panel WebSocket bridge](../../iossim/ios-sim-panel/README.md), plus pointer, keyboard, and hardware-button input forwarded to the seam's `input` verb. h264/hevc chunks decode through MediaSource Extensions on a `<video>` element at the live edge; mjpeg renders onto a `<canvas>`. Controls and status copy localize through the locale service (ru/en/zh). The panel is a GUI-only surface — it produces no session events and reads no agent state.

The package also owns the `sim_screenshot` key of the `tool.call.toolview` slot: a compact row naming the targeted device, whose collapsed-by-default disclosure draws the committed PNG through the session-authorized loader the chat node supplies and keeps the envelope text beside it. The row derives everything from the frozen call block (`presentationMeta.device`, then the `device` argument, else `auto`; the image references from the result's own image blocks), so a live call and a replayed log render identically. It declares no `tool.call.images` child — that child admits exactly one declarant, upstream's `read_image` row — and calls the loader directly instead, so composing no attachment presentation plugin changes nothing here.

## Table of Contents

- [Summary](#summary)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Model Experience

### Presentation-only panel

#### What the model sees

Nothing. The panel is presentation-only: its socket traffic, `MediaSource` decode pipeline, and device picker are invisible to the model and to the session log.

#### Token effect

Zero. The panel adds no tool schemas, prompt text, or session events.

#### KV Cache effect

None. The panel contributes no model-visible content.

## Known Limitations and Deferred Work

- **Read-only (M1)** — the panel streams but sends no gestures; pointer/keyboard input and the hardware-button surface land with M2 of the [panel proposal](../../../.agents/notes/proposed/architecture/2026-08-27-ios-simulator-panel.md).
- **MSE is the only h264 path** — WebCodecs Annex-B and a per-codec quality ladder land later; a browser without MSE for the negotiated codec shows the decode error and the user switches to mjpeg manually.
- **The framebuffer is single-consumer** — a Simulator presented by the host app starves the stream (documented by the upstream framework); boot screen-bearing work without the host app.
- **The screenshot row has no lightbox** — the raster renders inline at up to 480px tall with no zoom or open-in-viewer affordance; a gallery shared with `read_image` needs a second declarant of `tool.call.images` or a slot of its own, both deferred.
- **No keyless transcript snapshot for the row** — a `sim_screenshot` result needs a booted simulator, so the row is pinned by the package's jsdom specs (model, row, registration) rather than a recorded session.

<a id="dev-note"></a>
### Dev Note

None.
