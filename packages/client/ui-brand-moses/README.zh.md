# @deepseek-ai/dsh-client-ui-brand-moses

[English](README.md) | 中文

`dsh web` 的 Moses 品牌节点侧：把应用图标与 web manifest 作为不可变文本资产对外提供，并通过 `tapIndex` 转换把 shell 自身的 `<link>` 元素指向它们。

## Model Experience

None, as this package only rebrands static shell chrome; it mounts no routes that a model request could reach and contributes no prompts, schemas, or events.

#### KV Cache effect

None; nothing here participates in request assembly or history retention.

## Known Limitations and Deferred Work

- **仅静态资产** — 无按部署区分的图标变体；更换图稿需编辑本包。
- **`<link>` 重指假设既定标签形态** — shell 模板若改写方式不同，需在此同步更新正则。
