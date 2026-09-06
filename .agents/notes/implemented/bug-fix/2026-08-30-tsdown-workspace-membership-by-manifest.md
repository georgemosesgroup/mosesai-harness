# Agent Note: Workspace membership is a manifest, not a directory position

Status: implemented

English | [中文](2026-08-30-tsdown-workspace-membership-by-manifest.zh.md)

## Problem

`vendor/` holds pinned source copies, and until the iOS-simulator work every copy was a JavaScript package. `vendor/idb/` is an Objective-C and Swift tree slice with no `package.json`, and the root `tsdown.config.ts` selected build targets with the glob `vendor/*`. tsdown resolves each matched directory's manifest by walking up from that directory, so a directory without one resolves to the repository root. The root project compiles under `noEmit: true` and never writes `lib/types`, so the root's own entry glob cannot resolve, and the whole Host build phase fails before Typert runs:

```
ERROR [@deepseek-ai/dsh-root] Cannot find entry: ["lib/types/{index,invariant,startup}.js"]
```

The failure names the repository root, which owns neither the glob that selected the directory nor the vendored tree that lacks a manifest, so the message points away from both causes.

## Decision

The root `tsdown.config.ts` derives its vendored build targets from the filesystem instead of a glob: `vendoredPackages()` lists `vendor/` and keeps the directories that carry a `package.json`, sorted for a stable build order. `packages/*/*` and `apps/cli` stay globs, because every directory they match is a package by construction.

Membership is therefore the presence of a manifest, which is the property tsdown actually requires, rather than the directory's position under `vendor/`. A future non-JavaScript vendored copy joins the tree without touching this config and without reintroducing the failure.

## Alternatives considered

**Add a `package.json` to `vendor/idb/`.** Rejected by the vendoring policy it would violate: [vendor/README.md](../../../../vendor/README.md) states that `vendor/idb/` holds the pristine upstream tree slice and carries no local modifications. A synthetic manifest is a local modification, and it would also have to be paired with a local `tsdown.config.ts` whose only job is to suppress an entry the directory never had.

**Name `vendor/idb` in a tsdown `exclude` list.** Rejected as a standing debt: `exclude` replaces tsdown's default exclusion set, so the four defaults would have to be restated, and the next non-JavaScript vendored copy would fail the same way until someone remembered to extend the list. The failure it produces does not name the directory that caused it, so that discovery is expensive every time.

**Move the frameworks out of `vendor/`.** Rejected because `vendor/` is the documented home for pinned source copies of any kind, and the manifest in [vendor/README.md](../../../../vendor/README.md) already records the idb pin by commit. Relocating the tree to satisfy a glob would move the source away from the policy that governs it.

## Consequences

The Host build phase completes on a tree containing a non-JavaScript vendored copy, which unblocks Typert generation, the Client phase, and the Web build behind it. Reading `vendor/` at config-evaluation time is a directory listing plus one `existsSync` per entry, paid once per tsdown invocation.

The config now performs filesystem work during evaluation, which the previous pure-literal form did not. That cost buys a rule that stays correct without maintenance; the alternative that avoided the filesystem was the exclusion list this section rejects.

## Testing

`pnpm run build` completes on a tree with `vendor/idb/` present, recording 204 client artifacts. The same tree with the previous glob reproduces the failure above, verified with the unrelated working-tree changes stashed, which is what established the failure as pre-existing rather than introduced.
