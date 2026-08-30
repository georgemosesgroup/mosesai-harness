---
description: "个人只读会话查看工具（peek_session_list、peek_session_read、peek_session_search），让一个模型会话检查同一 DSH 安装的其他会话。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-session-peek-moses

[English](README.md) | 中文

<a id="summary"></a>
## 概述

基于 `ctx.sessionQuery` 的个人只读会话查看工具（`peek_session_list`、`peek_session_read`、`peek_session_search`）。让一个模型会话检查同一 DSH 安装的其他会话，而不做任何变更。

## 目录

- [工具](#tools)
- [配置](#config)
- [启用](#enablement)
- [Model Experience](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="tools"></a>
## 工具

| 工具 | 用途 |
|---|---|
| `peek_session_list` | 按最新优先返回 `{ sessionId, title?, live, persisted, createdAt }` 行。 |
| `peek_session_read` | 单个会话的原始日志有界窗口（`limit`、`offset` 从最新向前计数）。 |
| `peek_session_search` | 跨整个安装的全文检索；传入 `sessionId` 可在单个会话内检索。通过 `nextCursor` 翻页。 |

三个工具严格只读：唯一触及的能力是 `ctx.sessionQuery`。未知 id 与被禁用的搜索按普通错误抛出（模型看到 `isError` 结果）。每个渲染器都执行字符预算。

<a id="config"></a>
## 配置

`defaultLimit`（20）、`maxLimit`（100）、`eventTextMaxChars`（4000）、`maxOutputChars`（24000）、`searchTimeoutMs`（30000）、`searchStabilizationRetries`（2）。

<a id="enablement"></a>
## 启用

把 insert 行加入 `$DSH_HOME/profiles/web/cordis.patch.yml`；`peek_session_search` 需要配置了 `openAt: first-search` 或更早的 `session-query-sqlite`。

<a id="model-experience"></a>
## Model Experience

### 请求上下文与条件

#### What the model sees

一个 `session-peek:usage` 系统提示词 section（order 114），说明这些工具为协调目的暴露同一安装的其他会话；另有生成的 [tool catalog](../../../docs/tool-catalog.zh.md) 中的三个工具 schema。

##### 本字段的逐字文本

```markdown
session-peek gives you read-only access to OTHER sessions recorded by this DSH install. Use peek_session_list to see what else is running, peek_session_read to review another session's log, and peek_session_search to find relevant prior work.
```

#### Token 效果

固定：挂载期间每个 agent 请求一次性增加约 60 token 的 section，另有三个 schema 条目。

#### KV Cache 效果

会话内追加且前缀稳定；重载插件或更改其配置会在下一次请求替换该前缀片段。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

- **只读是设计使然** —— 没有向其他会话发送消息或进行变更的机制；通知渠道暂缓。
- **全文检索需要已打开的 SQLite 索引** —— 部署必须以 `openAt: first-search` 或 `startup` 挂载 `dsh-session-query-sqlite`。

<a id="dev-note"></a>
### 开发备注

无。
