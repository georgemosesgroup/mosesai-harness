---
description: "个人跨会话协调插件：TTL 路径租约，加上阻止写入型工具调用落入其他会话存活租约的结构化强制。"
kind: "package-reference"
---

# @deepseek-ai/dsh-session-coordination-moses

[English](README.md) | 中文

<a id="summary"></a>
## 概述

个人跨会话协调插件：TTL 路径租约（"claim"），加上阻止写入型工具调用落入其他会话存活租约的结构化强制。

## 目录

- [服务](#service)
- [工具](#tools)
- [强制](#enforcement)
- [Model Experience](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="service"></a>
## 服务

`ctx.sessionCoordination` —— 进程内 claim 存储（`acquire/release/list/check`）。租约受 TTL 约束，在访问时与周期定时器下清扫，并在持有会话释放时丢弃。

<a id="tools"></a>
## 工具

| 工具 | 用途 |
|---|---|
| `workspace_acquire` | 为本会话获取 glob 模式上的 TTL 租约。 |
| `workspace_release` | 释放本会话持有的全部租约。 |
| `workspace_claims` | 列出每个存活 claim 及其持有者／过期时间／备注。 |
| `workspace_check` | 检查某一路径是否处于存活租约之下。 |

<a id="enforcement"></a>
## 强制

`tools/pre-execute` 监听器对目标路径落在其他会话存活租约下的 write/edit 调用予以拒绝（或转为询问）。配置：`enforcement: 'off' | 'deny' | 'ask'`（默认 `'deny'`）、`enforcedTools`（默认 `['write','edit']`）、`bypassPaths`。Shell 命令被有意地不覆盖。

<a id="model-experience"></a>
## Model Experience

### 请求上下文与条件

#### What the model sees

一个 `session-coordination:usage` 系统提示词 section（order 115），说明路径租约礼仪与四个工具 schema。

##### 本字段的逐字文本

```markdown
Path leases: several parallel sessions of this DSH install work over shared repositories. Before starting work that will write into areas another session may also touch, call workspace_acquire on the glob patterns you are about to modify (keep the TTL honest), and call workspace_release when you finish.
```

#### Token 效果

固定：挂载期间每个 agent 请求一次性增加约 100 token，另有四个 schema 条目。

#### KV Cache 效果

会话内追加且前缀稳定；重载或重新配置会替换该前缀片段。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

- **不覆盖 shell** —— 任意 bash 命令无法可靠解析；shell 侧的协作需自行完成。
- **acquire 时的重叠检测是尽力而为** —— 权威仲裁发生在写入时，通过逐路径 check。
- **仅限进程内** —— 主机重启后 claim 消失；多进程协调需要外部后端。

<a id="dev-note"></a>
### 开发备注

无。
