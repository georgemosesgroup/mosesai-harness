# Agent Note: A plugin owns its Remote mount and its enablement

Status: implemented

English | [中文](2026-08-30-plugins-mount-their-own-remote-namespace.zh.md)

## Problem

A plugin that adds a Typert Remote used to reach the browser only by being named in [`packages/api/remotes/src/client/index.ts`](../../../../packages/api/remotes/src/client/index.ts): an import of its generated `/remote` contribution, an entry in the mount loop, and a re-export of its wire vocabulary. That file belongs to the shared Client assembly, so a plugin developed outside the upstream line had to edit an upstream file to exist at all.

The cost is paid on every update. Merging 1079 upstream commits into this tree produces 41 conflicting files, and this assembly is one of them — not because the two sides disagree about anything, but because both added rows to the same list. The conflict recurs for every future plugin and every future merge, and it is indistinguishable from a real disagreement until someone reads it.

## Decision

A plugin that owns a Remote namespace mounts it itself. Its Client half imports its own generated contribution and calls `ctx.remote.$mount()` inside `apply`:

```ts ignore-check
import difExplorerRemote from '@deepseek-ai/dsh-dif-explorer/remote'

export const inject = ['slots', 'locale', 'remote']

export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const unmount = await ctx.remote.$mount(difExplorerRemote)
  // dictionary and slot registration
  return unmount
}
```

Three properties make this the same operation the assembly performed, not a parallel path to it:

`$mount` is the assembly's own mechanism. Its loop over the listed contributions calls exactly this method, which is public on `ctx.remote` and binds its disposer to the caller's fiber through `ctx.effect()`. A plugin mounting one contribution and an assembly mounting twelve differ only in how many.

The client-bundle purity gate sanctions the import. `GENERATED_REMOTE` in [`packages/client/tsdown.client.ts`](../../../../packages/client/tsdown.client.ts) admits a value import of any `<package>/remote` specifier by pattern, not by an allowlist of packages, and comments the intent: a wire contribution is meant to be inlined. Every other cross-plugin value import stays forbidden.

The mount and the calls sit at different levels. `remote.difExplorer` cannot go in the plugin's own `inject`: that list waits for the namespace to appear, and a plugin that mounts it would wait on its own effect. Nor can the declaration simply be dropped — Cordis refuses the property read itself, with `cannot get property "remote.difExplorer" without inject`, regardless of who mounted it. Ownership does not grant access; only a declaration does. So the plugin mounts at its own level and registers the slot inside `ctx.inject(['remote.difExplorer'], scope => …)`, the nested-scope form this repository's Client packages already use. The scope is the declaration, and the mount above is what settles it.

This keeps the rule in [the API Gateway page](../../../../docs/api-gateway.md) intact rather than departing from it: the dependency belongs to whichever code reads `ctx.remote.<namespace>`, and is withheld from code that only mounts. Both roles live in one package here, so both appear — one as the plugin's own `inject`, one as the nested scope's.

The assembly keeps what is genuinely shared: the forwarded-event allowlist that `$on` selects from, and the wire vocabulary re-exports that let one Client contribution name types another package owns. A plugin whose Remote only carries calls needs neither.

## Enablement travels with the plugin

The same ownership rule decides composition. A plugin is no longer listed in [`packages/bundle/web-app/cordis.patch.yml`](../../../../packages/bundle/web-app/cordis.patch.yml); it ships `enablement/web-profile.cordis.patch.yml` under its own directory, holding the `insert` rows that mount it. A profile applies that file through `--patch`, or an operator copies its rows into `$DSH_HOME/profiles/<name>/cordis.patch.yml` and links the packages from that profile's manifest — the layer order in [the profile contract](../../../../packages/boot/app-boot/README.md#profiles) puts both above every bundle layer.

The pattern is the one [`tool-security-scan-moses`](../../../../packages/security/tool-security-scan-moses/README.md) already uses; the DIF Explorer follows it rather than inventing a second way to be composed. Both its rows live in one file because neither plane works alone: the Host gateway answers calls the browser tab makes, and the tab mounts the namespace those calls travel on.

The consequence is that the shipped `web` bundle no longer carries this plugin, so a profile that does not name it does not get it. That is the point — the bundle describes the product's own composition, and a plugin developed outside that line states its own.

## Alternatives considered

**Keep listing plugins in the Client assembly.** Rejected as the cost this note removes: one conflicting file per merge, growing with each plugin, carrying no information about what actually changed. It also makes a plugin's existence conditional on editing a file it does not own, which is the coupling the plugin architecture exists to avoid.

**Ask upstream for a registration seam on the assembly.** Rejected as unnecessary work: `$mount` already is that seam, and the purity gate already blesses the import it needs. A new API would duplicate a public method that is one call away.

**Keep the composition rows in the `web-app` bundle.** Rejected for the same reason as the assembly listing, with an added one: a bundle's patch states the shipped product's composition, so a row there claims the plugin is part of that product. It is not, and the claim would have to be re-made in every merge that touches the file.

**Fork `api/remotes` and maintain a divergent assembly.** Rejected as the worst of both: it converts a recurring line-level conflict into a recurring whole-file merge, and it puts a copy of the shared wire vocabulary under local ownership where it would drift from the Host declarations it projects.

## Consequences

[`packages/api/remotes`](../../../../packages/api/remotes/README.md) — its Client assembly, manifest, and Client tsconfig — plus the `web-app` bundle's patch and manifest are byte-identical to upstream, so five of the files that diverged from it are gone permanently rather than resolved once per merge.

The contribution is inlined into the mounting package's browser bundle, which brings its dependency closure with it. The `ui-dif-explorer` client bundle carries `zod` for this reason and measures 217.11 kB raw, 43.75 kB gzipped. A second plugin mounting a second contribution pays for its own copy; the assembly's single bundle previously amortized that across all of them. This is the trade the decision buys independence with, and it scales with the number of fork-owned Remote namespaces, not with their size.

`apply` returning a disposer makes the namespace's lifetime the plugin's own: unloading the plugin unmounts the namespace, where before the namespace outlived every consumer because the assembly owned it.

## Testing

`tsc -b tsconfig.client.json` reports no error on the Client face with the assembly restored to upstream, which is the check that would fail if the namespace typing depended on the assembly rather than on the contribution import. The `ui-dif-explorer` browser bundle builds through the purity gate, which is the check that would fail if the `/remote` value import were not admitted. `pnpm run build` completes end to end.

Runtime behavior was verified by hand against a running `dsh web` server composed from a profile outside the repository: the Explorer tab mounts, the file tree renders, the worktree ledger lists uncommitted changes, and a diff opens — with no slot crash in the browser console. That check is what found the access rule above; `tsc`, the purity gate, and `pnpm run build` were all green while the panel crashed on first render. A keyless snapshot through a real runnable example remains owed, and would have caught it.
