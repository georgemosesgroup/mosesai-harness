---
description: "Personal read-only session-peek tools (peek_session_list, peek_session_read, peek_session_search) that let one model session inspect other sessions of the same DSH install."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-session-peek-moses

English | [中文](README.zh.md)

<a id="summary"></a>
## Summary

Personal read-only session-peek tools (`peek_session_list`, `peek_session_read`, `peek_session_search`) over `ctx.sessionQuery`. Lets one model session inspect OTHER sessions of the same DSH install without mutating anything.

## Table of Contents

- [Tools](#tools)
- [Config](#config)
- [Enablement](#enablement)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="tools"></a>
## Tools

| Tool | Purpose |
|---|---|
| `peek_session_list` | Newest-first rows `{ sessionId, title?, live, persisted, createdAt }`. |
| `peek_session_read` | Bounded raw-log window of one session (`limit`, `offset` counts back from newest). |
| `peek_session_search` | Full-text search across the install; pass `sessionId` to search inside one session. Cursor pagination via `nextCursor`. |

All three are strictly read-only: the only capability touched is `ctx.sessionQuery`. Unknown ids and disabled search throw ordinary errors (model sees `isError` results). Every renderer enforces a character budget.

<a id="config"></a>
## Config

`defaultLimit` (20), `maxLimit` (100), `eventTextMaxChars` (4000), `maxOutputChars` (24000), `searchTimeoutMs` (30000), `searchStabilizationRetries` (2).

<a id="enablement"></a>
## Enablement

Add the insert row to `$DSH_HOME/profiles/web/cordis.patch.yml`; requires `session-query-sqlite` with `openAt: first-search` or later for `peek_session_search`.

## Model Experience

### Request context and condition

#### What the model sees

A `session-peek:usage` system-prompt section (order 114) explaining that these tools expose other sessions of the same install for coordination purposes, plus three tool schemas in the generated [tool catalog](../../../docs/tool-catalog.md).

##### Verbatim text for this field, when needed

```markdown
session-peek gives you read-only access to OTHER sessions recorded by this DSH install. Use peek_session_list to see what else is running, peek_session_read to review another session's log, and peek_session_search to find relevant prior work.
```

#### Token effect

Fixed: the section adds roughly 60 tokens once per agent request while the plugin is mounted, plus three schema entries.

#### KV Cache effect

Append-only and prefix-stable within a session; reloading the plugin or changing its config replaces that prefix slice on the next request.

## Known Limitations and Deferred Work

- **Read-only by design** — no mechanism to send messages to or mutate other sessions; a notification channel is deferred.
- **Full-text search requires an open SQLite index** — deployments must mount `dsh-session-query-sqlite` with `openAt: first-search` or `startup`.

<a id="dev-note"></a>
### Dev Note

None.
