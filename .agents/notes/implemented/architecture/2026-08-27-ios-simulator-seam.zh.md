# Agent Note: iOS 模拟器 seam：level-0 词汇、点值或坦白缺席的几何、以及 image 结果卡片

Status: implemented


[English](2026-08-27-ios-simulator-seam.md) | 中文

## 问题

iOS 模拟器是 harness 驱动的第一个既不是文件系统、也不是 web 端点的宿主表面：substrate 是 `xcrun simctl`，它的公开表面能做 list／boot／install／launch／screenshot／openurl，却既不能点按，也不能描述 UI 树。已有一份分阶段计划，后续阶段会加入由 idb 支撑的输入和视频流。如果这份约定只按 level-0 能做什么来勾画，就会在两种失败模式出现之前先把它们锁死：更丰富的提供方到来时，会话事件与渲染意图的词汇都得重新设计；而消费方会养成按截图坐标点按的习惯，恰恰与计划中的 element-reference 接口背道而驰。

有三个具体问题必须在同一个 PR 里定下来——面向模型的事件（`iosSim/action`）、`sim_launch` 就设备几何汇报什么、以及截图卡片携带哪一种渲染意图——因为每一个都触及一个封闭联合类型或一种持久化日志结构，其影响远超这些新包本身。

## 决策

**三个包组成的 seam，带强制 gating。** `dsh-ios-sim` 拥有类型化的约定和一套封闭的十项能力名（`list, boot, install, launch, terminate, screenshot, openUrl, describe, input, stream`）。每个动词在动手之前先查阅提供方声明的子集，并以 `SIMULATOR_CAPABILITY_UNAVAILABLE` 拒绝，同时点名缺失的能力、该动词以及提供方自己的名字；`do*` 钩子保留同样拒绝的默认实现，因此「声明了却没实现」也会同样大声地失败（`unadvertisedCapabilities` 为每套提供方测试给出一致性证明）。动词与能力之间有两处刻意的不对应，在此一次性记下：`shutdown` 搭乘 `'boot'`（同一项电源状态能力），而 `'stream'` 目前还没有方法（保留名）。这就是 [capability-seam](2026-06-13-capability-seams.zh.md) 的角色划分，不打任何折扣地落地。

**未来的 seam 以拒绝成员的形式先立约定。** `describe`（`input`）今天返回 `Promise<never>`：调用方甚至无法从中写出一个合法的成功类型。现在就声明它们在运行时不花任何代价，却能让第 2 阶段的表面保持 element-reference 的形状——约定文字明确禁止在截图上按坐标点按——而不是在发布之后再去改造两套 SDK 投影。

**几何是点值或坦白缺席，绝不推导。** 已对照当前的 Xcode 安装核实：公开的 simctl 表面没有点尺寸查询，profile plist 里不带显示尺寸，截图光栅是原生像素且没有公开的缩放事实。因此 `SimulatorLaunchResult.geometry` 只在提供方**能够**为其作证时才填充；否则由记录在案的 `geometryNote` 点明可用性树是将来的来源。一张人工维护的「标识符→点值」表被否决：那是悄然过时的数据，会一路搭车进入模型诊断。

**`image` 渲染意图加入封闭联合类型。** 完成后的 `sim_screenshot` 卡片在 `dsh-tools/presentation` 中变为 `{ card: 'image', origin?, attachmentId, mediaType, bytes, width, height }`：扁平标量镜像序列化后的 `ImageAttachmentRef`（沿用 WebSource 的先例——core 不能 import 附件 seam），GUI 经由既有的会话附件路由加载光栅，回放从持久化的 `output.presentationMeta` 重建出完全相同的视图，而未知卡片的回退仍是协议约定。`generic`／`terminal` 对图像载荷在语义上是错的，而在内容块里塞一个无 schema 的口袋，正是这个联合类型存在所要阻止的漂移。

**寻常的词汇增长，不做版本跃迁。** `iosSim/action` 是 log-only 的（派生历史忽略它），经由与 `todo/write` 相同的 `session.append` 路径发出；`KNOWN_SESSION_EVENT_TYPES` 由 `gen-persistence-catalog` 在仓库内重新生成，而 `SESSION_FORMAT_VERSION` 按[版本机制](2026-08-10-session-log-version-mechanism.zh.md)保持为 `0`。

## 后果

level-0 今天就提供真实的控制，并以大声的失败取代假装：不同的错误码分别对应「去修 xcode-select」「去装 iOS 平台」和「启动或点名一台设备」；非 macOS 的组合干脆拒绝加载该提供方。消费方看到的截图是一等的图像（持久提交发生在任何日志写入之前；base64 绝不搭乘事件），而审计轨迹能回答谁对哪台设备做了什么。GUI 目前只显示元数据卡片——面板一侧的光栅加载要等一个经会话授权的 loader 抵达工具表面，这件事记在已知限制里，而不是半通不通地接上去。第 2／4 阶段的工作必须在仓库内扩展能力词汇（仓库外扩展推迟），针对 idb 级别的提供方实现 `doDescribe`／`doInput`，此后才可以把 `Promise<never>` 的方法体换成带类型的载荷；这个 seam 的其余部分都不需要重新设计。

## 曾考虑的替代方案

- **由消费方在调用时探测能力**（「调用并捕获」）——把强制挪出了操作本身，还会把配置错误变成重试循环；按[在操作处强制](../../../../docs/cookbook/adding-a-tool.zh.md)否决。
- **在动词内部做可选的 `?? default` 目标解析**——那是隐藏的默认值；改为导出 `resolveSimulatorTarget`（重新列举、三种失败码）作为唯一的默认化步骤。
- **人工维护的设备尺寸表**——它字面上满足了「返回几何」，却在 Apple 每发一台新设备时就把错误数字送给模型；出于证据优先的理由否决。
- **复用 `generic` 卡片并塞一个图像内容块**——今天的 generic 渲染器会把图像块字符串化成 JSON 噪声，这恰恰证明这一渲染意图对协议而言是真正的新信息，而不是装饰。
