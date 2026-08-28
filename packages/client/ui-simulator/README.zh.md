# dsh-client-ui-simulator

[English](README.md) | 中文

Web GUI 中的模拟器面板页签：经 [ios-sim-panel WebSocket 桥](../../iossim/ios-sim-panel/README.zh.md)对一台 iOS 模拟器 framebuffer 的实时视图。页签在挂载时连接、渲染设备清单并进行直播：h264/hevc 块经 MediaSource Extensions 在 `<video>` 元素上解码；mjpeg 编解码器把帧渲染到 `<canvas>` 上。启动流使用提供方的默认编码器；停止即释放 framebuffer 流。控件与状态文案是产品文本（中文）；面板是仅限 GUI 的表面——它不产生会话事件、不读取 agent 状态。

## Model Experience

### 仅作呈现的面板

#### 模型看到什么

什么都不看到。面板仅作呈现：它的套接字流量、`MediaSource` 解码管线与设备选择器对模型和会话日志都不可见。

#### Token 效应

零。面板不新增工具 schema、提示文本或会话事件。

#### KV Cache 效应

无。面板不贡献任何模型可见内容。

## Known Limitations and Deferred Work

- **只读（M1）**——面板只直播不发送手势；指针/键盘输入与硬件按钮表面随 M2 落地（[面板提案](../../../.agents/notes/proposed/architecture/2026-08-27-ios-simulator-panel.zh.md)）。
- **MSE 是唯一的 h264 路径**——WebCodecs Annex-B 与逐编码器质量阶梯稍后落地；对协商出的编码器没有 MSE 的浏览器会显示解码错误，用户手动切到 mjpeg。
- **framebuffer 是单消费者**——由宿主应用呈现的模拟器会让流饿死（上游框架已记录）；承载屏幕的工作以无宿主应用的方式启动。
