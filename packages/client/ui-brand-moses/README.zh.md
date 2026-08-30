---
description: "Moses AI brand occupants for the browser shell and the Russian language pack, active in the Moses web build; for maintainers choosing or replacing brand presentation and locale."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-brand-moses

[English](README.md) | 中文

## 概述

本包承载 `dsh web` 的 Moses AI 重塑品牌：它以 Moses 的标记与名称填充侧边栏与会话 hero 的品牌 slot，把应用图标与 web manifest 作为不可变文本资源提供，并通过 `tapIndex` 转换把 shell 自身的 `<link>` 元素重新指向它们。它还向 locale 运行时贡献俄语语言包——第三种可选 locale——经由 `addLanguage` 加上按 namespace 的 `register`，使共享词汇与设置里的语言行得以翻译。locale 包本身与上游保持一致；一切与俄语相关的内容都住在这里。当部署的身份是 Moses AI 时选用本包；采用其他品牌的部署会把另一个包组合进同样的 slot。

## 目录

- [Model Experience](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="model-experience"></a>
## Model Experience

None, as the rebrand plugin serves static shell chrome and a language pack; nothing enters a model request.

#### KV Cache effect

None; nothing here participates in request assembly or history retention.

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **仅静态资源** —— 没有按部署区分的图标变体；更换美术素材意味着编辑本包。
- **`<link>` 重指向假定了随附的标签形状** —— 一个写法不同的 shell 模板需要在这里同步更新对应的正则。

<a id="dev-note"></a>
### 开发备注

无。
