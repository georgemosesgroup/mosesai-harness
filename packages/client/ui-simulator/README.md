# dsh-client-ui-simulator

English | [中文](README.zh.md)

The simulator panel tab in the Web GUI: a live view of one iOS simulator's framebuffer over the [ios-sim-panel WebSocket bridge](../../iossim/ios-sim-panel/README.md). The tab connects on mount, renders the device inventory, and streams: h264/hevc chunks decode through MediaSource Extensions on a `<video>` element; the mjpeg codec renders frames onto a `<canvas>`. Starting a stream uses the provider's default codec; stopping releases the framebuffer stream. Controls and status copy are product text (Chinese); the panel is a GUI-only surface — it produces no session events and reads no agent state.

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
