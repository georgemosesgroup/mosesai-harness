# Agent Note: iOS 模拟器面板 — helper 流之上的实时 GUI

Status: proposed


[English](2026-08-27-ios-simulator-panel.md) | 中文

## 问题

Harness 以无头方式驱动模拟器。[native-provider note](../../implemented/architecture/2026-08-27-ios-simulator-native-provider.zh.md) 已经交付了专业面板所需的服务面——实时编码视频句柄（`startStream`：h264/hevc/mjpeg、帧率、缩放）、对着元素引用或设备坐标的输入手势、以及可用性树——但没有任何东西以可视方式消费它。今天人要么透过 Apple 的 Simulator.app 看设备（它占用 framebuffer，让我们的流饿死），要么用截图轮询——而同一份 note 已把轮询否决为「比查看器和流都差」。GUI 只显示工具卡片，截图卡片渲染的是元数据而非栅格。

## 提案

Web GUI 中的模拟器面板：经 WebSocket 桥接、对设备 framebuffer 的实时硬件解码视图，带真实输入。环路中没有任何截图。

- **传输。** 宿主 webserver 已注册 HTTP upgrade 路由；面板打开一条经会话授权的 WebSocket。帧以二进制消息流向浏览器（helper 的 type-1 块原样）；指针与键盘事件以小 JSON 流向 agent 方向。
- **解码。** 首选：对 h264/hevc Annex-B 块使用 WebCodecs `VideoDecoder` 渲染到 `<canvas>`——端到端硬件编解码（helper VideoToolbox 编码 → 浏览器解码），显示级刷新率，无重编码。回退：请求 MJPEG 流直接渲染——任何浏览器都行，画质较低。
- **输入。** canvas 上的指针事件经 `sim_describe` 的屏幕尺寸（canvas 缩放 × 原点）映射为设备坐标点，走既有 `input` 动词：tap、长按（tap duration）、滑动拖拽、双指。键盘把浏览器按键映射为 HID usage 码；往字段里输文本走 `text`（accessibility setValue）。硬件按钮（home、siri、音量）、锁屏、摇一摇与方向走 HID button/orientation 事件——helper 的新增参数，而非新操作。
- **边界。** 面板是仅 GUI 的表面：它的手势不记录（按已实施 note 的面板输入决定），agent 的 transcript 不受影响，且不会出现任何其唯一诚实取值是标签的控件——每个控件都驱动真实动词，因为每个都改变可观察行为。

### 里程碑

1. **实时视图（只读）。** WS 桥 + WebCodecs canvas；配置的 codec/fps/缩放；设备切换；断连安全停止。
2. **控制。** 指针→tap/长按/滑动（坐标映射）；键盘 usage-码映射；硬件按钮、锁屏、摇一摇、方向。
3. **打磨。** 双指手势；逐设备面板页签；解码失败回退 MJPEG；掉帧遥测。

## 备选方案

**截图轮询。** 已实施的 note 已否决把轮询当终态；对专业面板，其延迟（秒级）、CPU 成本与画质损失直接不合格。

**VNC 服务。** 在 helper 里挂 VNC/RFB 端点、用浏览器 VNC 客户端，是把百行桥接换成第二套协议、一个外部客户端依赖，以及失去可用性树。

**原生 Swift 面板。** 直接嵌 FBSimulatorControl 的 macOS 应用零传输成本地拥有 framebuffer，但它活在 harness 之外，无法复用会话/附件/WebGUI 管线，且重复实现提供方。

**在 agent transcript 里渲染。** 帧不是 model-visible，绝不能进会话日志；transcript 显示工具结果，不是实时表面。

## 验收标准

- canvas 以配置的帧率渲染设备，硬件编码（helper）+ 硬件解码（浏览器）——一条 h264 路径在 Chrome 与 Safari 上验证。
- canvas 上的一次指针 tap 与等价 `sim_input` 坐标 tap 落在同一设备点。
- 键盘输入在聚焦文本框中出字；home/锁屏/摇一摇/方向控件产生可见的设备效果。
- 关页、provider 销毁与 helper 监管重启时流干净停止；消费者停滞时无无界缓冲出现。
- 面板手势不产生任何 `iosSim/action` 记录。

## 风险

**Framebuffer 单消费者。** 由宿主应用（`Simulator.app`，Xcode 27 起为 `DeviceHub.app`）呈现的模拟器占用 framebuffer；helper 的流会饿死。缓解：面板提供一键**脱离**操作（退出宿主应用——已启动的设备继续运行）并以响亮的诊断信息指名当前呈现的应用；若 framebuffer 已被占用，面板降级为标注清楚的低保真截图轮询，而不强迫用户在 Simulator.app 与面板之间二选一。值得做一次实验：验证当前 Xcode 的 CoreSimulator 是否接受宿主应用之外的第二个媒体客户端（`xcrun simctl io screenshot` 可并发工作，说明媒体捕获有并发路径；只有 IOSurface 订阅看起来是独占的）。

**浏览器对 Annex-B H264 的解码支持不一。** 面板加载时以 `VideoDecoder.isConfigSupported` 探测。路径阶梯，全部是框架原生：Annex-B 上的 WebCodecs（Chromium 与 Safari 均自带）→ `fmp4` 传输 + MSE（框架自带的第三种传输；普遍支持的硬件解码）→ MJPEG（任何浏览器，画质较低）。没有浏览器被落下，选择只是一个 `FBVideoStreamTransport` 值。

**实时语义在消费者缓慢时丢块。** 对实时视图这是正确的——有界延迟胜过缓冲的过期。对不允许丢数据的用例，helper 提供录制（`startRecording(toFile:configuration:)` 写出真实视频文件），且编码器的码率控制（`quality` 0–1 或目标 bitrate）在链路缓慢时自适应缩小块，让丢块在发生之前就变稀有。

**面板手势仅限 GUI 且不记录。** 对 agent transcript 这是有意的——但人类手势的审计痕迹确有需求。面板变更将新增一个独立的**仅记录 `iosSim/panel-action` 事件**（事件词汇增长；`SESSION_FORMAT_VERSION` 保持 `0`，依 level-0 先例）：它记录手势家族与目标，绝不携带模型上下文，派生历史忽略它。已实施 note 的面板输入决定预见到的正是这个类型。
