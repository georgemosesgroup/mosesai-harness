---
description: "iOS 模拟能力接缝的 Service Definition（`ctx.iosSimulator`）：类型化的设备生命周期契约与每个 provider 自行声明的十项能力词汇表。"
kind: "package-reference"
---

# dsh-ios-sim

[English](README.md) | 中文

<a id="summary"></a>
## 概述

iOS 模拟能力接缝的 Service Definition（`ctx.iosSimulator`）。它拥有类型化契约——设备列表、生命周期（`boot`/`shutdown`）、应用部署、启动、截图、URL 打开——以及十项能力的词汇表 `{ list, boot, install, launch, terminate, screenshot, openUrl, describe, input, stream }`，由每个 provider 自行声明。Provider 以普通子类形式加载，每个组合只挂载一个；Consumer 不导入具体实现。

三项契约决定是有意为之且持久的：

- **门禁位于操作本身。** 每个动词先查询 provider 声明的能力集合。未声明的能力以 `SimulatorError` 代码 `SIMULATOR_CAPABILITY_UNAVAILABLE` 拒绝，消息同时点名缺失能力、动词与 provider 名称——绝无静默 no-op，也绝无空答案式成功。`do*` 钩子保持默认拒绝，使"声明了却没实现"同样响亮（[不变量](../../../packages/AGENTS.md)）。
- **`describe` 与 `input` 从第一天起就在契约中。**公开 `simctl` substrate 上的任何提供方都不可能实现它们——`simctl` 既无触控注入也无可用性树读取——它们属于原生提供方（[Agent Note](../../../.agents/notes/implemented/architecture/2026-08-27-ios-simulator-native-provider.zh.md)）：`describe` 自 phase 2 起携带类型化的可用性树结果，而 `input` 在 phase 3 之前仍返回 `Promise<never>`，`'stream'` 在词汇表中保留（尚无方法）给未来的视频接缝。
- **几何信息要么是点，要么是显式缺席。** `SimulatorPointsSize` 是逻辑点（points），原点在左上角。仅当 provider 能为 `launch` 结果背书时才携带几何值；否则填充 `geometryNote`（`GEOMETRY_UNAVAILABLE_NOTE`）并指名未来来源。任何地方都不做编造的像素→点换算。

## 目录

- [Config](#config)
- [Events](#events)
- [Invariant companion](#invariant-companion)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="config"></a>
## Config

无——本包是纯词汇表；配置属于各实现。

<a id="events"></a>
## Events

自身不产生事件；会话日志事件由 Consumer 包拥有。

<a id="invariant-companion"></a>
## Invariant companion

按说明理由为空（`src/invariant.ts`）：本包不产生事件或持久状态，没有可监听的运行时关系。Provider 与 Consumer 的 companion 覆盖各自的表面。

<a id="model-experience"></a>
## Model Experience

None, as the definition is pure capability vocabulary; consumers such as `dsh-tool-ios-sim` own every projection.

#### KV Cache effect

None; nothing here participates in request assembly or history retention.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **暂无面向组合的注册面**——仓库外插件无法扩展封闭能力词汇；扩展 `SimulatorCapability` 是与全部 Consumer 分支同改的仓库内编辑。等第二个不同需求的 provider 家族出现再开放（会话日志侧的对应先例见 [version-mechanism note](../../../.agents/notes/implemented/architecture/2026-08-10-session-log-version-mechanism.zh.md)）。

<a id="dev-note"></a>
### 开发备注

无。
