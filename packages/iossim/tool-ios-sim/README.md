---
description: "Model-facing iOS-simulator tools (sim_list, sim_launch, sim_open_url, sim_screenshot, sim_describe, sim_input) over the capability seam, logging one iosSim/action record per successful call."
kind: "package-reference"
---

# dsh-tool-ios-sim

English | [中文](README.zh.md)

<a id="summary"></a>
## Summary

Model-facing iOS-simulator tools over the [capability seam](../ios-sim/README.md) (`ctx.iosSimulator`). The package registers six tools — `sim_list`, `sim_launch`, `sim_open_url`, `sim_screenshot` (phase 1) plus `sim_describe` and `sim_input` (phase 3, served by the [native provider](../ios-sim-native/README.md)) — and every successful call appends one **`iosSim/action`** record to the calling agent's session log, so replay shows which device did what even when result text alone would not tell. Schemas flow into the generated [tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-ios-sim); this file notes only deltas.

`sim_describe` reads the frontmost application's availability tree and mints stable element references; `sim_input` performs one gesture — tap, swipe, key, text entry — against either an element reference or a device point. Both verbs require the [native provider](../ios-sim-native/README.md): the public `simctl` substrate has no touch injection and no availability-tree read, so no provider over it can ever implement them ([Agent Note](../../../.agents/notes/implemented/architecture/2026-08-27-ios-simulator-native-provider.md)). An `input` audit record names its target — an element reference or a point — and never carries the text a text entry set.

## Table of Contents

- [Render intent — decided up front](#render-intent-decided-up-front)
- [The iosSim/action event](#the-iossim-action-event)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="render-intent-decided-up-front"></a>
## Render intent — decided up front

The completed `sim_screenshot` card is **neither `generic` nor `terminal`; it is a dedicated arm of the render-intent union**: `ImageResultView { card: 'image', origin?, attachmentId, mediaType, bytes, width, height }`, added to the closed union in [`dsh-tools/presentation`](../../core/tools/src/presentation.ts) (the same move that once introduced the web card). Reasons:

1. The screenshot IS the payload. A generic row flattens an image block into JSON noise; a terminal card implies stdout/exit semantics that do not exist here.
2. The view's flat scalars mirror the serialized `ImageAttachmentRef` vocabulary so a UI can load the raster through its existing session attachment route (`readAttachment`) without any new wire type — replay rebuilds the identical card from persisted `output.presentationMeta`.
3. Today's GUI renders this as a metadata card (px · KB · mediaType · attachment id) inside `ui-tool`; pane-side raster preview lands when tool surfaces gain a session-authorized image loader (tracked below), and hosts that cannot draw it fall back to raw content per union convention.

The pending call stays `generic kind:'other'` — nothing about a screenshot exists before it completes.

<a id="the-iossim-action-event"></a>
## The iosSim/action event

Payload (`IosSimActionEventData`): verb discriminant + resolved target facts (+ list count / bundle+pid / URL / committed-image reference fields for screenshots). Log-only: derived history ignores it, replay reads it. Base64 never rides it.

## Model Experience

### The tools

#### What the model sees

`sim_list(device?)` returns ids/names/states/runtimes; `sim_launch(bundle_id, device?)`, `sim_open_url(url, device?)`, and `sim_screenshot(device?)` echo the RESOLVED target so later calls name devices explicitly. Launches report pid when printed plus the geometry note when the provider cannot attest points; screenshots return one small envelope (`<device>`, pixel size, native-raster caveat) beside one committed image block. `sim_describe(device?)` returns the frontmost application's availability tree — element references, roles, labels, frames in points, enabled state — and `sim_input(action, target, …)` performs one gesture against an element reference or a device point and echoes where it landed.

#### Token effect

Conditional and small, with a hard visible component for screenshots: list rows and launch/open envelopes scale with fleet size and truncation-prone names; the screenshot path adds ~40 fixed envelope tokens PLUS one image block whose retained cost follows the harness image policy (validated/downscaled before the next request). Errors are one-line, repair-named messages rather than dumps.

#### KV Cache effect

Append-only while the tool catalog itself is static: schemas join the stable tool prefix, results extend the context, and image blocks retain across turns until eviction policy drops older ones. Element references from `sim_describe` keep interaction correctable instead of re-reading stale rasters — but a re-describe repaginates a live UI, so a reference that outlives its read fails loud. Verbose failure→retry loops invalidate nothing but do grow suffixes; repair hints exist to keep those loops short.

## Known Limitations and Deferred Work

- **Screenshot card shows metadata, not yet the raster, inside the GUI** — tool panes have no session-authorized loader today; the wired `card: 'image'` data path and fallback behavior are complete.
- **No stream tool** — `'stream'` stays a reserved capability name (no method yet) for the future video surface ([the note's ladder](../../../.agents/notes/implemented/architecture/2026-08-27-ios-simulator-native-provider.md)).
- **No install/build helpers** — deploying apps stays outside phase 1; the seam already carries `install` for providers that implement it.

<a id="dev-note"></a>
### Dev Note

None.
