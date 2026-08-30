---
description: "Read-only Host gateway behind the browser DIF Explorer surface, exposing workspace roots, a change ledger, file content at any revision, and unified diffs with host-side secret masking."
kind: "package-reference"
---

# @deepseek-ai/dsh-dif-explorer

English | [中文](README.zh.md)

<a id="summary"></a>
## Summary

Read-only Host gateway behind the browser's DIF Explorer surface (`dsh-client-ui-dif-explorer`). The namespace `difExplorer` exposes workspace roots, a gitignore-aware file tree, the change ledger over three scopes (persisted agent sessions, uncommitted worktree, recent commits), file content at any revision, and unified before→after diffs with graceful degradation for binary or oversized material.

Every method is read-only by construction:

- Filesystem reads confine each client path through canonicalization plus realpath containment inside the requested workspace root; traversal like `../` and symlink escapes reject with `PathOutsideWorkspaceError`.
- Git runs through one allowlisted subcommand set (`status`, `diff`, `log`, `show`, `ls-files`, `rev-parse`, `cat-file`, `name-rev`) via argv-array exec, no shell, paths always behind `--`.
- Secret material never reaches the wire: secret-named files (`.env*`, key/pem material, credential stores) collapse to a withheld notice, and recognized token shapes in other text (PEM blocks, provider tokens, JWTs, `SECRET=…` assignments) are masked host-side before any response is built.
- There are no write endpoints and no staging/commit/push capabilities anywhere in this package.

## Table of Contents

- [Config](#config)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="config"></a>
## Config

None. Roots come from `ctx.workspaceRegistry`; session ledgers come from `ctx.sessionPersistence`.

## Model Experience

None, as the Host gateway serves browser UI only and never enters an LLM request.

#### KV Cache effect

None; nothing here participates in request assembly or history retention.

## Known Limitations and Deferred Work

- Session-ledger statuses derive from logged tool arguments alone, so a `write` entry reports status `A` (creation implied by the missing old side) without consulting whether the path existed before; byte sizes for fragment-based entries describe the fragments, not whole files.
- The commit ledger lists the most recent 300 commits per request; deeper history needs explicit pagination work.
- Diff rows cap at 5000 emitted rows per response and sides above 1 MiB degrade to `--numstat` statistics; there is no server-side paging into oversized content yet.

<a id="dev-note"></a>
### Dev Note

None.
