---
description: "Read-only Web DIF Explorer tab — file tree, change ledger, and diff viewer over the confined difExplorer Host Remote; for maintainers of the workspace-explorer surface."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-dif-explorer

[English](README.md) | 中文

<a id="summary"></a>
## 概述

Web DIF Explorer 标签：一个只读视图标签项，与 Chat/Trajectory 并列，架在 `difExplorer` Host Remote 上。三个表面共享会话主体列——带 worktree 状态徽章的工作区文件树、跨 sessions/worktree/commits 且带 status/tool/path 过滤器的变更账本、支持统一/拆分渲染与词级行内高亮的 before→after diff 查看器。

严格只读：本插件不注册任何工具、任何可写服务调用，也不渲染可编辑内容。全部文件系统事实来自受限并遮蔽秘密的 Host 网关（`@deepseek-ai/dsh-dif-explorer`）。

## 目录

- [概述](#summary)
- [查看器行为](#viewer-behavior)
- [Model Experience](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="viewer-behavior"></a>
## 查看器行为

- 拆分偏好经 `localStorage` 持久化；其余查看器状态按设计为组件本地（`conversation.view` slot 契约不带 store，与 trajectory 项一致）。
- 打开 diff 内的热键：`j`/`k` 移动 hunk 焦点，`n`/`N` 跳转变更簇，`t` 切换 split/unified，`Esc` 关闭文件。
- 每次响应尾部最多渲染 500 行；更大的内容留在服务端（Host 已截断或降级为 numstat 统计）。

<a id="model-experience"></a>
## Model Experience

None, as the browser tab renders workspace state and registers no tools or prompt sections.

#### KV Cache effect

None; nothing here participates in request assembly or history retention.

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 查看器状态（打开的根、选中文件、过滤器）在标签卸载时重置——恢复它需要 `conversation.view` 允许 slot-store 或显式运行时投影；二者当前都不存在。
- 模糊过滤仅按子序列得分排序；尚无缩写目录跳转词汇。

<a id="dev-note"></a>
### 开发备注

无。
