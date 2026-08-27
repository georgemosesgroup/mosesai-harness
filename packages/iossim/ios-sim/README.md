# dsh-ios-sim

English | [中文](README.zh.md)

Service Definition for the iOS-simulator capability seam (`ctx.iosSimulator`). It owns the typed contract — device listing, lifecycle (`boot`/`shutdown`), app deployment, launch, screenshots, URL opening — plus the ten-name capability vocabulary `{ list, boot, install, launch, terminate, screenshot, openUrl, describe, input, stream }` that every provider declares about itself. Providers are mounted one-per-composition as ordinary subclasses loaded like any other plugin; consumers never import them.

Three contract decisions are deliberate and durable:

- **Gating lives in the operation.** Every verb first consults the provider's declared capability set. A verb the provider did not declare rejects with `SimulatorError` code `SIMULATOR_CAPABILITY_UNAVAILABLE`, naming the missing capability, the verb, and the provider's own name — never a silent no-op, never an empty-answer success. The `do*` hooks stay defaulted with the same rejection, so an advertised-but-unimplemented capability is equally loud ([invariant](../../../packages/AGENTS.md)).
- **`describe` and `input` are part of the contract now.** No provider over the public `simctl` substrate can ever implement them — `simctl` has no touch injection and no availability-tree read — so they belong to the native provider ([Agent Note](../../../.agents/notes/implemented/architecture/2026-08-27-ios-simulator-native-provider.md)): `describe` carries its typed availability-tree result from phase 2, while `input` returns `Promise<never>` until phase 3 and `'stream'` is reserved in the vocabulary (no method yet) for the future video surface.
- **Geometry is points-or-absence.** `SimulatorPointsSize` is logical points, origin top-left. `launch` results carry it only when the provider can attest it; otherwise they carry `geometryNote` (`GEOMETRY_UNAVAILABLE_NOTE`) naming the future source. No invented pixels-to-points conversions anywhere.

## Config

None — the definition is pure vocabulary; implementations own their own configuration.

## Events

None of its own. The consumer package owns the session-log event.

## Invariant companion

Empty by stated reason (`src/invariant.ts`): the definition produces no events or durable state, so nothing here has a live relationship to watch. The provider and consumer companions cover their own surfaces.

## Model Experience

None, as `ctx.iosSimulator` is an in-process capability interface that reaches models only through Consumer projections such as [`dsh-tool-ios-sim`](../tool-ios-sim/README.md).

#### KV Cache effect

Nothing here enters requests or history: mounting the seam extends neither any cached prefix nor any retained transcript; consumers own both effects. Re-projections of Consumers follow the Consumers' own cache story.

## Known Limitations and Deferred Work

- **No composition-facing registration surface yet** — an out-of-repo plugin cannot extend the closed capability vocabulary; extending `SimulatorCapability` is an in-repo edit shared with every consumer branch. Deferred until a second provider family ships with different needs (the [version-mechanism note](../../../.agents/notes/implemented/architecture/2026-08-10-session-log-version-mechanism.md) carries the matching session-log precedent).
