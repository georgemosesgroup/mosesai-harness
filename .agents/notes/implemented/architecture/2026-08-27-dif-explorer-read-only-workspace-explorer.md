# Agent Note: DIF Explorer — a read-only workspace explorer over a confined Host Remote

Status: implemented


English | [中文](2026-08-27-dif-explorer-read-only-workspace-explorer.zh.md)

## Problem

Web had no way to see which files a workspace holds, what its sessions or git history changed, or what a change actually looked like, without leaving the harness for a terminal. Folding persisted `tool/call` events gives the before/after of edits that are not committed anywhere yet, which git alone cannot show. Any such surface must also be strictly read-only: path confinement, an argv-array git allowlist, secret-file withholding, and content masking have to live on the Host side, so no client code path can mutate a workspace or leak credential material.

## Decision

Added `@deepseek-ai/dsh-dif-explorer` (Host) and `@deepseek-ai/dsh-client-ui-dif-explorer` (browser) plus Russian locale support in `dsh-client-locale`. The Host gateway exposes one read-only `difExplorer` Remote namespace: workspace roots from `ctx.workspaceRegistry`, a gitignore-aware file tree, a change ledger over three scopes (persisted agent sessions folded from `ctx.sessionPersistence` logs, uncommitted worktree, recent commits), revision-addressed file content, and unified before→after diffs. The browser package contributes one `conversation.view` tab (Files / Changes panes plus a diff viewer with unified and split modes, word-level intra-line highlighting, and hunk-navigation hotkeys).

`DifExplorerGateway` extends `TypertRemoteService` (`namespace difExplorer`) and resolves roots through `workspaceRegistry` on every call. Filesystem access funnels through `resolveInsideRoot`, which confines lexically first (so deleted paths stay diffable) and then against the realpath to close symlink escapes. Git runs through one allowlisted subcommand set (`status`, `diff`, `log`, `show`, `ls-files`, `rev-parse`, `cat-file`, `name-rev`) via argv-array `execFile` with paths behind `--`; anything else refuses before spawning. Session entries fold `write`/`edit`/`str_replace_editor` events into entries with fragment byte sizes and hunk counts; `getDiff` accepts either file mode (base/head revisions through `git show`, raw bytes for binary detection) or tool-call mode (the logged fragment pair). Diffs use jsdiff `structuredPatch` capped at 5000 emitted rows, degrade to `--numstat` statistics above 1 MiB sides, and mask `.env`/key-file content plus recognized token shapes before anything reaches the wire. The browser half folds `RemoteResult` envelopes once in its apply closure, so components consume plain promises; viewer state is component-local because the `conversation.view` slot contract carries no store (same pattern as the trajectory entry).

## Consequences

The surface is read-only by construction — there are no write endpoints and no staging/commit/push capabilities anywhere in this package, so client code cannot mutate a workspace or leak credential material. Required verification: keyless `pnpm exec vitest run packages/host/dif-explorer packages/client/ui-dif-explorer packages/client/locale` (65 package tests: hunk model incl. truncation and binary heuristics, masking policy, path confinement with symlink escape, wire parsers, session fold, tree/fuzzy model, split/unified assembly), with `pnpm run lint` and `pnpm run typecheck` green. Live acceptance against `/Volumes/Moses/IT/VideoChain` on a real `dsh web` server: `listRoots` lists three roots, `listTree` serves the gitignore-aware tree, hand-made new/edit/delete appear exactly in the worktree ledger with a correct +2 hunk diff, the acceptance commit appears in the commit ledger with clean ISO timestamps, another DSH session's logged `edit` calls appear in the session ledger with tool `Edit` and correct fragment before/after via tool-call mode, a 1.2 MB file degrades to `oversized` statistics, and `../../etc/passwd` rejects with `path escapes the workspace root`.

## Alternatives considered

- **A store on the view slot** for open-root/selected-file state — restoring it across tab unmounts would need either a slot-contract change with cross-package sign-off or a runtime projection, both out of scale for a first version; viewer state stays component-local and resets on unmount.
- **Host-side word diffing** (`diffWordsWithSpace`) — runs lazily in the browser per visible changed pair (module-level cache) instead, trading a little duplicated work for bounded payloads.
- **Pre-existing-file awareness in session-ledger statuses** — statuses derive from logged arguments alone (`write` with no old side implies `A`), never consulting whether the path pre-existed; consulting the filesystem per row was rejected as out of scale for the ledger's read model.
