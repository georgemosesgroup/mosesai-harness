---
description: "Package map for the iOS-simulator plane: the capability seam, its simctl and native providers, the model-facing tools, and the browser panel bridge."
kind: "package-group"
---

# iossim/ — iOS 模拟器控制平面

[English](README.md) | 中文

## 概述

iossim 组从 harness 驱动一台 iOS 模拟器：一个能力 seam 声明一组封闭的动词，每个组合挂载一个 provider，面向模型的工具与浏览器面板都消费这同一个 seam。先从 seam 和一个 provider 起步——`ios-sim-simctl` 经由公开的 `xcrun simctl` 表面覆盖 `list`／`boot`／`launch`／`screenshot`，`ios-sim-native` 则经由 vendored 的 FBSimulatorControl helper 加上 `describe`、`input` 与实时编码视频 `stream`。`tool-ios-sim` 把已挂载 provider 声明的动词投影为 agent 工具；`ios-sim-panel` 把视频流与手势经一条 WebSocket 桥接到浏览器标签页。本页映射该组；每个包的 README 拥有自己的约定，而 [iOS 模拟器子系统页](../../docs/subsystems/ios-sim.zh.md) 是该 seam 与后端无关的参考。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 | ctx key |
|---|---|---|
| [`ios-sim/`](ios-sim/README.zh.md) | 定义类型化的 `ctx.iosSimulator` seam：封闭的能力词汇、逐动词 gating，以及每个 provider 与 consumer 共享的请求／结果类型 | `ctx.iosSimulator` |
| [`ios-sim-simctl/`](ios-sim-simctl/README.zh.md) | 基于公开 `xcrun simctl` 表面的 level-0 provider：list、boot、install、launch、screenshot、open-url | 注册到 `ctx.iosSimulator` |
| [`ios-sim-native/`](ios-sim-native/README.zh.md) | 基于 FBSimulatorControl helper 的原生 provider：可用性树（`describe`）、手势（`input`）与实时编码视频句柄（`stream`） | 注册到 `ctx.iosSimulator` |
| [`tool-ios-sim/`](tool-ios-sim/README.zh.md) | 把已挂载 provider 声明的动词投影为面向模型的工具（`sim_list`、`sim_launch`、`sim_screenshot`、`sim_describe`、`sim_input` 等）以及 `iosSim/action` 记录 | `ctx.tools` |
| [`ios-sim-panel/`](ios-sim-panel/README.zh.md) | 浏览器桥接：把 provider 的视频流经 WebSocket 重新封帧，并把面板手势转发给 `input` 动词 | 注册一条 web 升级路由 |

-----

<a id="related-documentation"></a>
## 相关文档

- [iOS 模拟器子系统](../../docs/subsystems/ios-sim.zh.md) —— 与后端无关的 seam 约定：能力词汇、逐动词 gating、点值或坦白缺席的几何，以及 image 结果卡片。

<a id="dev-note"></a>
## 开发备注

None.
