# Agent Note: ui-simulator 中的 sim_screenshot 键控工具视图

Status: implemented

[English](2026-09-07-sim-screenshot-keyed-toolview.md) | 中文

## Problem

`sim_screenshot` 返回 `[文本信封, 图片块]` 并持久化图片的 `presentationMeta`，但 Web 转录通过通用工具行渲染它，而通用行会把图片块展平成信封下方的 JSON。派生分支早先的修复位于上游的 `ToolDetails.tsx` 与 `GenericToolCard.tsx` 内部，读取的是上游此后已重塑的 `ImageCardModel` 字段，并且在每次上游合并时冲突；0.1.3 集成把它丢弃了。上游现在通过键控的 `tool.call.toolview` 槽位（`read_image`）和一个只允许单一声明者的 `tool.call.images` 子槽位拥有图片渲染。

## Decision

`@deepseek-ai/dsh-client-ui-simulator` 在现有视图标签旁，以 `key: 'sim_screenshot'` 和 `locale: 'simulator'` 把 `ScreenshotRow` 注册到 `tool.call.toolview`。该行沿用 `ui-skill` 的先例：自有的摘要行（设备标签、运行中扫光、错误与中断状态、隐藏的状态文案），配合默认折叠的展开区承载已提交的光栅与信封文本，并在拥有者提供 `inspect` 时显示查看按钮。

`screenshotRowModel(block)` 是纯视图模型：设备先取 `presentationMeta.device`，再取 `device` 参数，否则为 `auto`；状态来自已结算的切片；图片引用从结果自身的图片块收窄并校验每个线上字段；任何非文本、非图片的块都会让卡片放弃，因此追加的内容永远不会被隐藏。放弃与失败的行展开显示展平的结果文本。

光栅由该行自身通过拥有者提供的 `loadImage` 绘制（`peek` 用于首次绘制，然后是 promise），因此该条目不声明 `tool.call.images` 子槽位，也从不导入附件实现。清单注入 `dsh-client-ui-tool` 以保证加载顺序；`dsh-attachment`、`dsh-client-ui-primitives` 与 `dsh-client-ui-tool` 成为 peer 依赖。

## Alternatives considered

**把图片分支留在 `ui-tool` 的通用行内。** 被拒绝：每次上游合并都会冲突，而派生分支的规则是 $mount 加启用，从不修改上游文件。

**把 `tool.call.images` 声明为本条目的子槽位并渲染共享画廊。** 被拒绝：槽位契约只允许一个声明者，第二个声明者在加载时抛出，而 `read_image` 持有它。

**拥有独立的画廊槽位并把 `ui-attachment` 的画廊注册进去。** 目前被拒绝：`ui-attachment` 不导出任何组件值，派生分支将不得不导入客户端 bundle 外部依赖无法解析的 `src/*` 路径；灯箱仍然推迟。

**复用 `ui-tool` 的 `readFamilyRow` 与 `ToolRow`。** 被拒绝：`ToolRow` 只有在提供 `renderSlot` 时才渲染图片卡片，而这需要上述子槽位声明，且其 `t` 属于 `conversation` 命名空间；自有的行让派生分支的副本留在自己的命名空间中。

## Consequences

已结算的 `sim_screenshot` 现在显示设备，展开后显示 PNG 及其尺寸、大小与媒体类型，而不是附件引用的 JSON 转储。派生分支放弃了共享画廊的灯箱，并多维护一个行实现。客户端目录把 `sim_screenshot` 列入已占用的键。

包规范固定了模型的设备优先级与放弃点、行的缓存、异步、失败与卸载后的加载路径、键盘展开、错误与中断状态，以及注册及其释放。由于结果需要已启动的模拟器，该行没有无密钥转录快照覆盖；包 README 记录了这一缺口。
