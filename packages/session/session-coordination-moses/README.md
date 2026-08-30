---
description: "Personal cross-session coordination plugin: TTL path leases plus structural enforcement that blocks write-shaped tool calls into another session's live lease."
kind: "package-reference"
---

# @deepseek-ai/dsh-session-coordination-moses

English | [中文](README.zh.md)

<a id="summary"></a>
## Summary

Personal cross-session coordination plugin: TTL path leases ("claims") plus structural enforcement that blocks write-shaped tool calls into another session's live lease.

## Table of Contents

- [Service](#service)
- [Tools](#tools)
- [Enforcement](#enforcement)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="service"></a>
## Service

`ctx.sessionCoordination` — in-process claim store (`acquire/release/list/check`). Leases are TTL-bounded, swept on access and by a periodic timer, and dropped when the owning session disposes.

<a id="tools"></a>
## Tools

| Tool | Purpose |
|---|---|
| `workspace_acquire` | Acquire a TTL-bounded lease on glob patterns for THIS session. |
| `workspace_release` | Release all leases held by THIS session. |
| `workspace_claims` | List every live claim with owner/expiry/note. |
| `workspace_check` | Check whether one path is under a live lease. |

<a id="enforcement"></a>
## Enforcement

A `tools/pre-execute` listener denies (or asks for) write/edit calls whose target path falls under a foreign live claim. Config: `enforcement: 'off' | 'deny' | 'ask'` (default `'deny'`), `enforcedTools` (default `['write','edit']`), `bypassPaths`. Shell commands are deliberately NOT covered.

## Model Experience

### Request context and condition

#### What the model sees

A `session-coordination:usage` system-prompt section (order 115) explaining the path-lease etiquette and four tool schemas.

##### Verbatim text for this field, when needed

```markdown
Path leases: several parallel sessions of this DSH install work over shared repositories. Before starting work that will write into areas another session may also touch, call workspace_acquire on the glob patterns you are about to modify (keep the TTL honest), and call workspace_release when you finish.
```

#### Token effect

Fixed: roughly 100 tokens once per agent request plus four schema entries while mounted.

#### KV Cache effect

Append-only and prefix-stable within a session; reloading or reconfiguring replaces that prefix slice.

## Known Limitations and Deferred Work

- **Shell is not covered** — arbitrary bash commands cannot be parsed reliably; coordinate shell work yourself.
- **Acquire-time overlap detection is best-effort** — authoritative arbitration happens at write time via per-path check.
- **In-process only** — claims vanish on host restart; multi-process coordination requires an external backend.

<a id="dev-note"></a>
### Dev Note

None.
