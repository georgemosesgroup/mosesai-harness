# Agent Note: Keyed sim_screenshot toolview in ui-simulator

Status: implemented

English | [中文](2026-09-07-sim-screenshot-keyed-toolview.zh.md)

## Problem

`sim_screenshot` returns `[text envelope, image block]` and persists an image `presentationMeta`, but the Web transcript rendered it through the generic tool row, which flattens the image block into JSON under the envelope. The fork's earlier fix lived inside upstream's `ToolDetails.tsx` and `GenericToolCard.tsx`, read fields of an `ImageCardModel` upstream has since reshaped, and conflicted on every upstream merge; the 0.1.3 integration dropped it. Upstream now owns image rendering through the keyed `tool.call.toolview` slot (`read_image`) and a `tool.call.images` child that admits exactly one declarant.

## Decision

`@deepseek-ai/dsh-client-ui-simulator` registers `ScreenshotRow` under `tool.call.toolview` with `key: 'sim_screenshot'` and `locale: 'simulator'`, beside its existing view tab. The row mirrors the `ui-skill` precedent: a self-owned summary row (device label, running sweep, error and interrupted states, hidden status copy) with a collapsed-by-default disclosure holding the committed raster and the envelope text, plus the Inspect pill when the owner supplies `inspect`.

`screenshotRowModel(block)` is the pure view model: device from `presentationMeta.device`, then the `device` argument, else `auto`; state from the settled slice; image references narrowed from the result's own image blocks with every wire field validated; any non-text, non-image block declines the card so appended content is never hidden. Declined and failed rows disclose the flattened result text.

The raster is drawn by the row itself through the owner-supplied `loadImage` (`peek` for the first paint, then the promise), so the entry declares no `tool.call.images` child and never imports an attachment implementation. The manifest injects `dsh-client-ui-tool` for load order; `dsh-attachment`, `dsh-client-ui-primitives`, and `dsh-client-ui-tool` become peer dependencies.

## Alternatives considered

**Keep the image branch inside `ui-tool`'s generic row.** Rejected: every upstream merge conflicts, and the fork rule is $mount plus enablement, never edits to upstream files.

**Declare `tool.call.images` as this entry's child and render the shared gallery.** Rejected: the slot contract admits one declarant and throws at load on a second, and `read_image` holds it.

**Own a distinct gallery slot and register `ui-attachment`'s gallery into it.** Rejected for now: `ui-attachment` exports no component value, so the fork would import a `src/*` path that the client bundle externals do not resolve; a lightbox stays deferred.

**Reuse `readFamilyRow` and `ToolRow` from `ui-tool`.** Rejected: `ToolRow` renders an image card only with `renderSlot`, which needs the child declaration above, and its `t` is the `conversation` namespace; a self-owned row keeps the fork's copy in its own namespace.

## Consequences

A settled `sim_screenshot` now shows the device and, on expansion, the PNG with its dimensions, size, and media type instead of a JSON dump of the attachment reference. The fork gives up the shared gallery's lightbox and keeps one more row implementation to maintain. The client catalog lists `sim_screenshot` among the taken keys.

Package specs pin the model's device precedence and decline points, the row's cached, async, failed, and post-unmount load paths, keyboard disclosure, error and interrupted states, and the registration with its disposal. The row is not covered by a keyless transcript snapshot because a result needs a booted simulator; the package README records that gap.
