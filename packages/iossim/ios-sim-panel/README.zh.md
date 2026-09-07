---
description: "把原生 iOS 模拟器提供方的实时视频与设备清单经一条会话形套接字流式送往 Web GUI 模拟器面板的 WebSocket 桥。"
kind: "package-reference"
---

# dsh-ios-sim-panel

[English](README.md) | 中文

<a id="summary"></a>
## 概述

[模拟器面板](../../client/ui-simulator/README.zh.md)的 WebSocket 桥：一条 upgrade 路由（`/ios-simulator/stream`），把挂载的 [dsh-ios-sim-native](../ios-sim-native/README.zh.md) 提供方的实时流与设备清单泵给 Web GUI。JSON 控制自浏览器流向宿主（`start`/`stop`，携带编码器、帧率、缩放与设备旋钮）；二进制视频块自宿主逐字流向浏览器（提供方 `startStream` 句柄的输出）。`devices` 清单在名称与状态之外还携带每台设备的底层 `deviceTypeIdentifier` 与 `runtimeIdentifier`，因此面板无需再次往返即可按机型分组并区分运行时。路由挂在 webserver 的 upgrade 注册表上，带浏览器信任栅栏（loopback Host + cross-site/Origin 检查，`trustedHosts` 配置供局域网 GUI）；每个套接字一条流，关闭即停，被栅栏拒绝的升级得不到套接字。该表面仅限 GUI：帧与手势绝不进入会话日志。

在同时存在支持流能力的提供方与 webServer 的组合中挂载它（发行的 `dsh --profile web` 组合已挂载；不宣告能力的提供方会让每次 start 响亮地退化为错误帧）。

## 目录

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="model-experience"></a>
## Model Experience

### 仅限 GUI 的表面

#### 模型看到什么

什么都不看到。桥是仅限 GUI 的表面：它的帧、清单与控制消息从不进入模型请求，也不是会话事件。模型的模拟器视野仍是 `sim_*` 工具。

#### Token 效应

零。没有工具 schema、没有提示文本、没有会话事件。

#### KV Cache 效应

无。桥不贡献任何模型可见内容。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **面板手势不记录**——未来输入表面的人类手势不产生 `iosSim/action` 记录（[native-provider note](../../../.agents/notes/implemented/architecture/2026-08-27-ios-simulator-native-provider.zh.md) 的面板输入决定）；审计痕迹事件类型推迟到那个 GUI 变更（[面板 note](../../../.agents/notes/proposed/architecture/2026-08-27-ios-simulator-panel.zh.md)）。
- **栅栏按 loopback 形状**——非 loopback 的 GUI 宿主需在 `trustedHosts` 中列出其授权；upgrade 路由没有每会话令牌。

<a id="dev-note"></a>
### 开发备注

无。
