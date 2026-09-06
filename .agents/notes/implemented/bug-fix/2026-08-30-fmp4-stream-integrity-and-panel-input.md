# Agent Note: fMP4 integrity end to end, and the panel that drives the device

Status: implemented

English | [中文](2026-08-30-fmp4-stream-integrity-and-panel-input.zh.md)

## Problem

The simulator panel connected, negotiated h264, counted chunks — and rendered black with a decode error. The panel proposal's M1 was therefore unfinished, and M2 (input) had no surface to land on. Live debugging against a running server found four independent faults stacked on one symptom, which is why fixing any one of them changed nothing: the muxer emitted a `trun` box whose size field stayed a zero placeholder, so the browser demuxer rejected the very first media segment; the provider's chunk queue dropped the OLDEST chunks past a 128-chunk cap, tearing the byte stream deterministically under the encoder's warm-up burst; the panel's append path let a fresh WebSocket chunk overtake queued ones whenever a message task ran between an append completing and its `updateend` task, reordering the stream (`Invalid top-level ISO BMFF box type` on mid-frame bytes); and playback never chased the live edge, so even a healthy pipeline would have shown a frame as old as the buffered backlog, paused, with nothing retrying `play()`.

## Decision

fMP4 is treated as what it is — one continuous byte sequence that no layer may drop, reorder, or lag: the muxer closes `trun` like every other box; the provider queue is byte-bounded (64 MiB) and closes the stream loudly on overflow instead of shedding chunks; the panel append pump is strict FIFO (every chunk joins the tail, appends only take the head); and `holdLiveEdge()` runs on every `updateend`, seeking to the buffered edge when playback drifts past 1.5 s and retrying a paused element — the browser rejects autoplay in a backgrounded pane, and nothing else would ever retry.

On that repaired surface the panel drives the device over the same socket. Pointer down/up on the stream distinguishes tap from swipe at 8 CSS px, converts through the element box to device POINTS (render scale recovered from the disjoint point-width bands of shipping hardware — phones 250–520 pt at 3x, tablets 500–1100 pt at 2x — until `describe` can attest geometry), and sends `{action:'input'}`; the bridge validates and calls the seam's `input` verb against the streamed device, exactly the person-driven path the seam text promised, producing no session events. Keyboard rides USB-HID usages mapped from `event.code` with an `event.key` fallback for dispatchers that omit the physical code; a shifted press wraps the usage in a left-shift hold, which `shortKeyPress` alone cannot express. Hardware buttons extend the closed action union with `{kind:'button'}` over the substrate's own vocabulary (`home`, `lock`, `side_button`, `siri`, `apple_pay`, `play_pause`). The panel caps itself at `100dvh − 220px` because the tab container grows with content instead of bounding it, keeps the controls and hardware rows above the stream so shrinking only ever costs screen size, and all copy lives in `ru`/`en`/`zh` dictionaries behind the locale service — status and errors are stored as KEYS, so a language switch retranslates live state.

## Alternatives considered

**Fix layers one at a time, verifying between.** This is what happened, and it is why the note records all four together: each fix alone left the same black screen, and only the stacked repair was observable. Recording them separately would invite re-litigating "this fix did nothing".

**Keep drop-oldest live semantics in the provider queue.** Rejected: valid for whole-frame codecs (mjpeg), fatal for a byte-stream container. A consumer too slow for 64 MiB of backlog needs a restart, not a silently corrupted stream.

**Wait for `describe` to attest geometry instead of the scale heuristic.** Initially rejected because `describe` crashed the helper — a stack overflow in the serializer's unbounded AX recursion, since fixed by bounding the walk at `FBAXReadLimits` (depth 50, 3000 nodes). With `describe` serving, the bridge now sends the attested screen size after each stream start and the panel prefers it; the band heuristic remains only as the fallback for a bridge whose `describe` could not serve.

**A dedicated input WebSocket.** Rejected: the stream socket already carries typed JSON control messages both ways, and a second socket would duplicate the trust fence and the device binding for no isolation gain.

## Consequences

The panel is a working simulator: live h264 at the live edge, taps, swipes, typing, and hardware buttons, verified by eye against the running device (chip selection switched by a panel click, map panned by a panel drag, Spotlight opened by a panel swipe and filled from the physical keyboard, Home returned to the springboard). Input from the panel produces no `iosSim/action` records, preserving the model-visible ⟺ logged boundary. The costs: per-sample `trun` layout stays single-sample; and the panel's viewport cap hard-codes the app chrome's 220 px, which tracks the shell layout by hand until the tab container bounds its children.

## Testing

Verified live against `dsh web` on a booted iPhone 17 Pro: stream box-validated on the wire (609 moof/mdat pairs, zero anomalies), first `moof` byte-inspected (`trun` size 32, correct), then every interaction exercised from the panel with the device observed directly. `tsc -b` green across the four packages; client bundle and host bundles rebuilt. No automated coverage yet: the keyless snapshot lane cannot drive a booted simulator, and the live probe scripts remain session-local — a real test seam for the bridge (mock IosSimulator, recorded socket transcript) is the next testing debt.
