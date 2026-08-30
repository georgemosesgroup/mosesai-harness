---
description: "浏览器 DIF Explorer 表面背后的只读 Host 网关，暴露工作区根、变更账本、任意修订的文件内容与带 Host 侧秘密遮蔽的统一 diff。"
kind: "package-reference"
---

# @deepseek-ai/dsh-dif-explorer

[English](README.md) | 中文

<a id="summary"></a>
## 概述

浏览器 DIF Explorer 表面（`dsh-client-ui-dif-explorer`）背后的只读 Host 网关。命名空间 `difExplorer` 暴露工作区根、感知 gitignore 的文件树、跨三种范围（持久 agent 会话、未提交 worktree、近期提交）的变更账本、任意修订的文件内容，以及带二进制/超大文件优雅降级的 before→after 统一 diff。

每个方法在构造上都是只读的：

- 文件系统读取把客户端路径限制在请求的工作区根内（规范化 + realpath 包含）；`../` 之类穿越与符号链接逃逸以 `PathOutsideWorkspaceError` 拒绝。
- Git 只经允许列表子命令集合（`status`, `diff`, `log`, `show`, `ls-files`, `rev-parse`, `cat-file`, `name-rev`）以 argv 数组执行，无 shell，路径始终位于 `--` 之后。
- 秘密材料不上网络：秘密命名文件（`.env*`、key/pem 材料、凭据存储）折叠为 withheld 提示；其他文本中可识别的令牌形态（PEM 块、provider token、JWT、`SECRET=…` 赋值）在响应构建前 Host 侧遮蔽。
- 本包没有任何写端点或暂存/提交/推送能力。

## 目录

- [Config](#config)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="config"></a>
## Config

无。根来自 `ctx.workspaceRegistry`；会话账本来自 `ctx.sessionPersistence`。

<a id="model-experience"></a>
## Model Experience

None, as the Host gateway serves browser UI only and never enters an LLM request.

#### KV Cache effect

None; nothing here participates in request assembly or history retention.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- 会话账本状态仅从日志中的工具参数派生：`write` 条目报告状态 `A`（由缺失旧侧隐含创建），不回查路径此前是否存在；基于片段的条目字节大小描述的是片段而非整文件。
- 提交账本每次请求列出最近 300 条提交；更深历史需要显式分页工作。
- Diff 行每次响应上限 5000 行，超过 1 MiB 的侧降级为 `--numstat` 统计；尚无服务端向超大内容内部分页。

<a id="dev-note"></a>
### 开发备注

无。
