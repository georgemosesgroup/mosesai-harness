# Agent Note: Simulator panel as an instrument strip over a bench stage

Status: implemented

English | [中文](2026-09-07-simulator-panel-instrument-layout.zh.md)

## Problem

The simulator tab rendered a native `<select>`, unstyled `<button>` elements, a permanent device list, and an inline create form above the framebuffer. Its stylesheet referenced tokens that the Moses AI theme does not define (`--dsw-space-*`, `--dsw-text-secondary`, `--dsw-accent`), so every color fell back to hard-coded hex. The device list and forms took half the tab, the stream got what was left, and the status line (`Ready`, `Live (h264)`, errors) was plain text lost between buttons.

## Decision

The panel is an apparatus: one instrument strip over a bench-dark stage.

- The strip holds the device picker (a `Menu` from `dsh-client-ui-primitives`, rows grouped under Booted and Shut down with the power state as a caption, a footer with Boot/Shut down for the selected device and Create), one Start/Stop action, and a readout with a `StateDot`, the status text, and the codec as a small capsule.
- Device creation opens as a popover card under the picker with labelled fields, not as a permanent form.
- The stage is `--dsw-static-neutral-bluish-900` in both themes so the raster keeps contrast; the framebuffer has a hairline bezel and a grounded shadow; the empty, connecting, and stopped states share a dashed device silhouette with one line of copy.
- The hardware buttons are keycaps in a rail beside the device, disabled until the stream is live; the keyboard hint sits under them so nothing covers the screen.
- Every color and font comes from the theme aliases; the panel defines only its spacing scale and stage ink as local custom properties.

The socket, MSE, pointer, and keyboard logic is unchanged.

## Alternatives considered

**Keep the device list on the page and only restyle it.** Rejected: with two dozen simulators the list dominates the tab and the screen shrinks, which every use (watching the agent, driving by hand, showing a client) suffers from.

**Hardware buttons in the strip.** Rejected: they belong beside the device they act on; in the strip they compete with the picker and the readout.

**A modal for device creation.** Rejected: a modal blocks the stream and the chat; a popover under the picker keeps both visible.

**A light stage that follows the theme.** Rejected: a light stage lowers the contrast of a light iOS screen and reads as an empty card; the bench is dark in both themes on purpose.

## Consequences

The screen gets most of the tab in every viewport, the picker and readout say which device is selected and whether the stream is live, and the tab looks native to Moses AI. The panel now depends on `dsh-client-ui-primitives` at runtime (it already carried the type-only dependency for the screenshot row). The bridge's `devices` message carries each device's `deviceTypeIdentifier` and `runtimeIdentifier`; the panel groups the picker by model, one row per runtime with the newest first and booted models ahead, and labels the chip `model · runtime`, so two simulators of one model on different runtimes no longer read as duplicates. The labels are derived from the identifiers in the browser (`device-inventory.ts`), not resolved through the catalog, so the inventory stays one round trip.

The panel remains outside jsdom coverage (its socket and MediaSource lifecycle live in the browser); the redesign was verified against a booted iPhone 17 Pro through the running Web app: picker, Start, Live readout, Home keycap, Stop, and the create popover.
