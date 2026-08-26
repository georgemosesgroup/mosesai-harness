# @deepseek-ai/dsh-client-ui-dif-explorer

English | [中文](README.zh.md)

The Web DIF Explorer tab: one read-only view-tab entry beside Chat/Trajectory over the `difExplorer` Host Remote. Three surfaces share the session body column — a workspace file tree with worktree status badges, the change ledger across sessions/worktree/commits with status/tool/path filters, and a before→after diff viewer with unified and split render modes plus word-level intra-line highlighting.

Strictly read-only: the plugin registers no tools, no write-capable service calls, and renders nothing editable. All filesystem facts come from the confined, secret-masking Host gateway (`@deepseek-ai/dsh-dif-explorer`).

## Viewer behavior

- Split preference persists through `localStorage`; every other viewer state is component-local by design (the `conversation.view` slot contract carries no store, matching the trajectory entry).
- Hotkeys inside an open diff: `j`/`k` move hunk focus, `n`/`N` jump change clusters, `t` toggles split/unified, `Esc` closes the file.
- Rows cap at 500 rendered lines per response tail; larger content stays server-side (the Host already truncates or degrades to numstat statistics).

## Model Experience

None as a producer. This package is browser presentation only and never enters an LLM request.

#### KV Cache effect

None; nothing here assembles or sends a provider request.

## Known Limitations and Deferred Work

- Viewer state (open root, selected file, filters) resets when the tab unmounts — restoring it needs either a slot-store allowance on `conversation.view` or an explicit runtime projection; neither exists yet.
- The fuzzy filter ranks by subsequence score only; no abbreviated directory-jump vocabulary yet.
