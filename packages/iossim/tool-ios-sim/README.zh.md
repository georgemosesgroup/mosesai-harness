# dsh-tool-ios-sim

[English](README.md) | 中文

面向模型的 iOS 模拟器工具，架在[能力接缝](../ios-sim/README.zh.md)（`ctx.iosSimulator`）上。Phase 1 注册且仅注册四个动词——`sim_list`、`sim_launch`、`sim_open_url`、`sim_screenshot`——每次成功调用都会向调用 agent 的会话日志追加一条 **`iosSim/action`** 记录，回放时即可还原"哪台设备被做了什么"。Schema 自动汇入生成的 [tool catalog](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-ios-sim)；本文件只写增量。

没有输入动词、没有面板：phase-2 输入将读取设备可用性树中的元素引用；针对截图的坐标点击在设计上不可达，工具描述已用模型可见文本说明这一点。

## 渲染意图——先决定后实现

`sim_screenshot` 的完成态卡片**既不是 `generic` 也不是 `terminal`，而是渲染意图联合中新设的专属臂**：`ImageResultView { card: 'image', origin?, attachmentId, mediaType, bytes, width, height }`，加入 [`dsh-tools/presentation`](../../core/tools/src/presentation.ts) 的封闭联合（与当年引入 web 卡片同一路径）。理由：

1. 截图本身就是负载。generic 行会把 image block 摊平成 JSON 噪声；terminal 卡暗示了此处不存在的 stdout/exit 语义。
2. 视图平铺标量字段，刻意镜像序列化后的 `ImageAttachmentRef` 词汇，UI 可经既有会话附件通道（`readAttachment`）加载栅格而无需新线上类型；回放从持久化的 `output.presentationMeta` 重建完全相同的卡片。
3. 当前 GUI 在 `ui-tool` 内渲染为元数据卡（px · KB · mediaType · attachment id）；待工具表面获得会话授权的图像加载器后升级为栅格预览（见下），无法绘制的宿主按联合约定退回原始内容。

挂起调用保持 `generic kind:'other'`——完成前不存在任何可展示之物。

## iosSim/action 事件

载荷（`IosSimActionEventData`）：动词判别 + 解析后的目标事实（+ list 数量 / bundle+pid / URL / 截图的引用字段）。Log-only：派生历史忽略它，回放读取它。绝不携带 base64。

## Model Experience

### 四个 phase-1 工具

#### What the model sees

`sim_list(device?)` 返回 id/名称/状态/runtime；`sim_launch(bundle_id, device?)`、`sim_open_url(url, device?)`、`sim_screenshot(device?)` 回显解析后的目标，后续调用得以显式指名设备。launch 报告 substrate 打印的 pid；provider 无法背书点几何时给出 geometry note；截图返回一小段信封（`<device>`、像素尺寸、原生栅格警示）加一个已提交的 image block。

#### Token effect

条件性且很小，但截图有一块固定可见成本：列表行随设备数伸缩；截图路径除约 40 个固定信封 token 外还附一个 image block，其驻留成本遵循 harness 图像策略（进入下一请求前完成校验/缩放）。错误是一行的、指名修复方式的，而非倾倒堆栈。

#### KV Cache effect

在工具目录本身稳定的前提下 append-only：schema 加入稳定的前缀；结果延展上下文；image block 跨轮驻留直至淘汰策略移除旧图——届时以元素引用（phase 2）为主的交互仍可修正，而不必重读过期栅格。失败→重试环不会失效缓存但确实增长后缀；为此才有修复型提示词。

## Known Limitations and Deferred Work

- **GUI 中截图卡片暂显示元数据而非栅格**——工具面板尚无会话授权的加载器；`card: 'image'` 的数据通路与回退行为已完成。
- **没有 describe/input/stream 工具**——契约动词以 `SIMULATOR_CAPABILITY_UNAVAILABLE` 拒绝；工具随 phase-2 可用性树 provider 到来。
- **无部署/构建助手**——应用部署不在 phase 1；接缝已带 `install` 供实现的 provider 使用。
