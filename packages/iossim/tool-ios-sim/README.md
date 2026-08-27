# dsh-tool-ios-sim

English | [中文](README.zh.md)

Model-facing iOS-simulator tools over the [capability seam](../ios-sim/README.md) (`ctx.iosSimulator`). Phase 1 registers exactly four verbs — `sim_list`, `sim_launch`, `sim_open_url`, `sim_screenshot` — and every successful call appends one **`iosSim/action`** record to the calling agent's session log, so replay shows which device did what even when result text alone would not tell. Schemas flow into the generated [tool catalog](../../../docs/tool-catalog.md#tool-ios-sim); this file notes only deltas.

No input verbs and no panel: phase-2 input reads element references from the device availability tree; coordinate tapping on screenshots is out of reach by design, and the tool descriptions say so in model-facing text.

## Render intent — decided up front

The completed `sim_screenshot` card is **neither `generic` nor `terminal`; it is a dedicated arm of the render-intent union**: `ImageResultView { card: 'image', origin?, attachmentId, mediaType, bytes, width, height }`, added to the closed union in [`dsh-tools/presentation`](../../core/tools/src/presentation.ts) (the same move that once introduced the web card). Reasons:

1. The screenshot IS the payload. A generic row flattens an image block into JSON noise; a terminal card implies stdout/exit semantics that do not exist here.
2. The view's flat scalars mirror the serialized `ImageAttachmentRef` vocabulary so a UI can load the raster through its existing session attachment route (`readAttachment`) without any new wire type — replay rebuilds the identical card from persisted `output.presentationMeta`.
3. Today's GUI renders this as a metadata card (px · KB · mediaType · attachment id) inside `ui-tool`; pane-side raster preview lands when tool surfaces gain a session-authorized image loader (tracked below), and hosts that cannot draw it fall back to raw content per union convention.

The pending call stays `generic kind:'other'` — nothing about a screenshot exists before it completes.

## The iosSim/action event

Payload (`IosSimActionEventData`): verb discriminant + resolved target facts (+ list count / bundle+pid / URL / committed-image reference fields for screenshots). Log-only: derived history ignores it, replay reads it. Base64 never rides it.

## Model Experience

### Four phase-1 tools

#### What the model sees

`sim_list(device?)` returns ids/names/states/runtimes; `sim_launch(bundle_id, device?)`, `sim_open_url(url, device?)`, and `sim_screenshot(device?)` echo the RESOLVED target so later calls name devices explicitly. Launches report pid when printed plus the geometry note when the provider cannot attest points; screenshots return one small envelope (`<device>`, pixel size, native-raster caveat) beside one committed image block.

#### Token effect

Conditional and small, with a hard visible component for screenshots: list rows and launch/open envelopes scale with fleet size and truncation-prone names; the screenshot path adds ~40 fixed envelope tokens PLUS one image block whose retained cost follows the harness image policy (validated/downscaled before the next request). Errors are one-line, repair-named messages rather than dumps.

#### KV Cache effect

Append-only while the tool catalog itself is static: schemas join the stable tool prefix, results extend the context, and image blocks retain across turns until eviction policy drops older ones — after which coordinates-free element references (phase 2) keep interaction correctable instead of re-reading stale rasters. Verbose failure→retry loops invalidate nothing but do grow suffixes; repair hints exist to keep those loops short.

## Known Limitations and Deferred Work

- **Screenshot card shows metadata, not yet the raster, inside the GUI** — tool panes have no session-authorized loader today; the wired `card: 'image'` data path and fallback behavior are complete.
- **No describe/input/stream tools** — the contract verbs reject with `SIMULATOR_CAPABILITY_UNAVAILABLE`; tools arrive with the phase-2 availability-tree provider.
- **No install/build helpers** — deploying apps stays outside phase 1; the seam already carries `install` for providers that implement it.
