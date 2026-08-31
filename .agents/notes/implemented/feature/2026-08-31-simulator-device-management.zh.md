# Agent Note: 原生 provider 承载完整的设备生命周期，面板管理设备

Status: implemented

[English](2026-08-31-simulator-device-management.md) | 中文

## 问题

模拟器 seam 恰好挂载一个 provider。原生 provider 只承载 `describe`／`input`／`stream`，因此挂载它的组合就失去了 `list`、`boot` 以及其余每一个 simctl 动词——面板只能显示 helper 自动解析出的那一台已启动设备，无从列出其余设备、启动一台已关闭的设备，或在一台都没有时新建一台。seam 里根本没有 `create` 动词。

## 决策

`NativeSimulatorProvider` 现在继承 `SimctlSimulatorProvider`，而不是直接继承 `IosSimulator`，因此它继承了 `list`、`boot`、`shutdown`、`launch`、`screenshot` 与 `openUrl`——全都是纯 `xcrun simctl`——并在其上添加由 helper 支撑的 `describe`／`input`／`stream`。一个挂载的 provider 覆盖整个生命周期；任何组合都不必在 simctl 与 helper 之间二选一。基类的 `resolve()`（一个 simctl 调用规格）保持不动；原生的 helper 规格方法改名为 `resolveHelper()`，使两者永不冲突，而 `runSimctl` 改为 `protected` 以供子类复用。原生配置增加了 simctl 的 `maxOutputBytes`，其构造器把 macOS／xcrun 校验委托给 `super`。

seam 新增一个 `create` 能力，带两个动词 `create` 与 `listDeviceTypes`，二者都以 `create` gating（沿用 `shutdown` 搭乘 `boot` 的做法）。`create` 接收名称加设备类型与运行时标识符，返回 `list` 所观察到的新设备；`listDeviceTypes` 返回宿主的设备类型与运行时目录（`simctl list devicetypes -j`／`runtimes -j`），并把不可用的运行时报告出来而不是丢弃，以便面板将其置灰。simctl 与原生都声明 `create`。

面板桥接层新增 `refresh`、`boot`、`shutdown`、`create` 与 `deviceTypes` 这些 socket 动作；面板把每台列出的设备连同其电源状态与一个逐行的启动／关闭按钮一起渲染，外加一个 `+ 新建` 控件，点开后是名称输入框与设备类型／运行时选择器。全部文案都在 ru／en／zh 词典里。

## 曾考虑的替代方案

**同时挂载两个 provider。** 不予采纳：按约定 seam 恰好挂载一个 provider，两个会争抢 `ctx.iosSimulator` 的所有权。继承让一个 provider 获得完整集合，而不触碰这条不变式。

**在原生里复制 simctl 的动词。** 不予采纳：`list`／`boot`／`create` 就是 simctl 已经解析并测试过的那些 `xcrun simctl` 调用。继承该类复用了解析器、developer-dir 探测与超时策略，而不是照抄它们。

**专门开一条设备管理的 WebSocket 或 Remote。** 不予采纳：面板桥接层本就双向承载带类型的控制 JSON，信任栅栏与设备绑定都已就位；第二条通道只会重复这两者，换不来任何隔离收益。

**把 `listDeviceTypes` 并进 `list` 的结果。** 不予采纳：目录很大（这里 124 个设备类型），只有创建表单需要它；把它折进每一次 `list`，就会在每次面板连接时都发送它。

## 后果

面板能列出所有设备、启动或关闭其一，并从一个设备类型配一个运行时新建一台——已对着宿主实机验证（列出 35 台设备且已启动／已关闭划分正确、124 个设备类型与 3 个运行时、新建一台使计数升到 36 并在 `simctl` 中确认，随后启动至 `Booted`）。代价：原生 provider 现在像 simctl 一样在加载时需要 xcrun，因为它继承了 simctl 的构造器——这没问题，反正它本就仅限 macOS。`create` 目前还不是面向模型的工具；只有面板驱动它，因此不产生会话事件。

## 测试

在一台已启动的宿主上，经面板桥接层实机验证：`deviceTypes`、完整 `list`、`create` 与 `boot`，每一项都直接对着 `xcrun simctl` 确认；测试设备在之后被删除。`tsc -b` 在 seam、两个 provider、桥接层与面板上全绿；host 与 client 产物均已重建。尚无自动化覆盖——无密钥快照通道无法驱动模拟器，桥接层的测试缝（mock IosSimulator、录制的 socket transcript）仍然欠着，与输入那次一样。
