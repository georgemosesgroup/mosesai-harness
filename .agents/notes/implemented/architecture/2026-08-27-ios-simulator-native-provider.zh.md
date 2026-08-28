# Agent Note: iOS 模拟器 — 承载 describe、input 与 stream 的原生提供方

Status: implemented


[English](2026-08-27-ios-simulator-native-provider.md) | 中文

## 问题

[level-0 seam](../../implemented/architecture/2026-08-27-ios-simulator-seam.zh.md) 把 `describe`、`input`、`stream` 声明为契约成员，在提供方实现之前一律拒绝，并指明它们未来的归宿是 idb 一类的提供方。那份 Agent Note 对目的地的判断正确，但对抵达代价只字未提，于是周边正文被读成：剩下的工作不过是在同一 substrate 之上再写一个 TypeScript 包。事实并非如此，而这个差别决定了 phase-2 的工作能否开始。

当前 Xcode 上的 `xcrun simctl` 既不提供触控注入，也不提供可用性树读取；其 `ui` 子命令只设置外观与内容尺寸。任何参数、超时或解析上的努力，都无法让 `doDescribe` 或 `doInput` 在 `dsh-ios-sim-simctl` 上变得可达：这些操作在 substrate 上根本不存在，而不只是不便。因此，任何建立在该提供方之上的 phase-2 分支在评审之前就已经作废，这一点必须写进仓库，而不是留在评审者脑中。

另有两项事实决定了替代方案的形状。注入触控与读取树需要经由 FBSimulatorControl 和 FBControlCore 链接 CoreSimulator —— 即 idb 所依赖的框架 —— 这意味着一个原生的、独立构建、独立签名的可执行文件，而不是一个 workspace 包。而实时视频流需要在同一进程内使用硬件编码器，这正是 stream 能力无法在「每次调用一张截图」的提供方上事后补装的原因。

## 决定

新增第二个提供方 `dsh-ios-sim-native`，由一个链接 FBSimulatorControl、FBControlCore 与 VideoToolbox 的原生后台 helper 支撑。helper 承担公开 CLI 无法完成的每一项操作；提供方只是它的一个瘦类型化客户端。`dsh-ios-sim-simctl` 保留为没有 helper 的宿主上的回退，组合仍与今天一样只挂载一个提供方。

提供方之上的一切都不动。能力词汇表仍固定为十项，逐动词 gating 仍是强制点，`dsh-tool-ios-sim` 的四个工具保留其 schema，`iosSim/action` 仍是仅记录事件且 `SESSION_FORMAT_VERSION` 保持 `0`：更强的提供方声明更多能力，同一道 gate 放行更多动词。这正是 level-0 那份 Agent Note 买下的性质，本提案花的就是它。

### Gate 0 — 许可

在任何原生源码落地之前，已给出书面答案。FBSimulatorControl 与 FBControlCore 均位于 [facebook/idb](https://github.com/facebook/idb) —— 独立仓库已不存在（`facebook/FBSimulatorControl` 重定向到 idb，`facebook/FBControlCore` 已消失）—— 而该仓库以 [MIT](https://github.com/facebook/idb/blob/main/LICENSE) 许可（Copyright (c) Meta Platforms, Inc. and affiliates），框架级没有单独的许可文件，现行框架 README 中也没有 BSD 字样；旧 fork 里的 BSD 与专利授权文本属于已退役的独立仓库。允许以保留许可文本为前提进行再分发，因此 vendoring 可行，回退路径（用户自装的 `idb`，或 XCTest 路线）只作为备选项存在，而非被触发的切换。锁定的修订已记入 [vendor 清单](../../../../vendor/README.md)：两个框架均为 `main` 的 `8443cb759e31fb24c2a14aa970a3dc1907bcf1b5`（2026-08-27）。

### Phase 2 — helper 与 `describe`（已交付）

helper 以 [`native/iossim-helper`](../../../../native/iossim-helper/README.zh.md) workspace 的形式与 [`landlock-run`](../../../../native/README.zh.md) 并列，沿用其两层 npm 家族模板：拥有路径解析与协议常量的 entry 包，加上以文件路径解析、绝不被 import 的逐架构平台包。它是一个没有用户界面的后台可执行文件，由提供方拉起，通过标准流以长度前缀的 JSON 请求/响应协议通信；它的 hello 帧是拉起证明，stdin 上的 EOF 意味着完成，它不读任何环境变量。其框架源码是按锁定提交 vendored 在 `vendor/idb/` 的干净 idb 切片，构建把一切编译进一个自包含 Mach-O 二进制——可执行文件之外无可分发之物。

Phase 2 只实现一项能力：`describe` 返回一台设备的可用性树，由提供方 `dsh-ios-sim-native` 作为瘦类型化客户端承载——它监管 helper：异常退出即重启、有界的重试次数、越界后的具名耗尽代码、会杀掉卡死子进程的 deadline，以及先关 stdin 再等待的拆除。元素的角色、标签、标识、启用状态与以点为单位的 frame 来自框架，而不是对栅格图的解析。让 helper 只带一项能力上线，是对许可、构建、签名与拉起路径端到端可用的证明，在它们承载更多之前先行完成。

几何实证随树而来。describe 结果在读取实证它时携带以点为单位的屏幕尺寸——这正是 level-0 Agent Note 指定为几何未来源头的可用性树事实——而 `SimulatorLaunchResult.geometry` 保持其「点或诚实缺席」规则，仍只在能为启动几何背书的提供方服务时填充，这随 helper 能力集的成长而来；在 simctl 提供方之下，`geometryNote` 仍是答案。

### Phase 3 — `input` 与记录决定（input 已交付；面板表面仍待实现）

`input` 执行点按、滑动、按键与文本输入，其请求接受两种目标形式：来自前一次 `describe` 的元素引用，以及以设备坐标表示的点。level-0 的契约正文禁止坐标点按，是因为 level 0 无法为坐标系提供实证；helper 能实证几何，所以该禁令在承载动词的同一次变更中被改写进契约 JSDoc，且两种形式从该动词的第一次提交起就存在于请求类型中。

手势词汇骑在两个 substrate 表面上：点按与滑动走 helper 的 HID 传输（Indigo 或 DTUHID，逐模拟器协商），按键是 HID usage 码，文本输入经由可用性表面在解析后的点上设置元素值。元素引用对着提供方在其最近一次 describe 中铸造的引用解析（按提供方单条目缓存）；无法解析的引用以 `SIMULATOR_ELEMENT_REFERENCE_STALE` 拒绝并指名修复——重新 describe。

**面板输入的记录决定，在动词首次提交前敲定：面板发起的输入不记录。**`iosSim/action` 是模型动作词汇：它的记录由工具消费方在模型驱动动词时发出，而人的面板手势绝不会穿越该消费方，因此按构造不会产生任何动作记录。面板手势也不是 model-visible——做动作的是人，不是 agent——所以「模型可见则必被记录」的规则也不触及它。若 GUI 面板日后需要人类手势的审计痕迹，那是面板自己变更中的新的、独立的事件类型；`iosSim/action` 永不携带它们。

由模型发起的输入是 model-visible 动作，因此与其他动词一样追加一条 `iosSim/action` 记录：记录携带手势家族与审计所点名的目标——元素引用或设备点——而永不携带文本输入设置的文本。

面板的输入侧供——人点击画面、刷新控件让截图驱动的重绘滞后可见——仍是本阶段的 GUI 部分；它需要的服务与工具表面即上文所述。

### Phase 4 — `stream`（已交付）

`stream` 获得其方法（`startStream`），helper 通过 VideoToolbox 编码帧。帧率、分辨率缩放与编码器成为真实生效的提供方配置——装载期即校验（`streamCodec`：h264/hevc/mjpeg，`streamFrameRate`，`streamScale`），并可按请求覆盖——helper 以 type-1 二进制帧推送编码块，同时控制路径保持打开。慢消费者丢弃最旧的块而不是无限增长缓冲：实时语义，而非录制。只有当面板消费这一句柄时，其设置才成为某个东西的设置而不只是标签；在该 GUI 变更落地之前，不会呈现任何不改变可观察行为的流控件。

上游还划定了帧的来源边界：由宿主应用呈现的模拟器（`Simulator.app`，Xcode 27 起为 `DeviceHub.app`），其 framebuffer 被该应用进程占用，链接 FBSimulatorControl 的进程拿不到 —— 需要屏幕的工作必须以无宿主应用的方式启动，这是受支持的路径。

### 进程归属与失败

helper 是每个安装一个进程，而非每个会话一个，这与模拟器宿主的行为一致：两个会话驱动两台设备时共用一个 helper。提供方对它进行监管 —— 异常退出即重启、重试次数有上限、达到上限后给出独立错误码 —— 从而让 helper 死亡表现为一个具名的模拟器故障，而绝不是 agent 崩溃。会话拆除不得杀死另一会话正在使用的 helper；helper 的生命周期绑定安装进程，子进程归属的[防御性模式](../../../../docs/defensive-patterns.zh.md)原样适用。

### 与本阶梯无关的一项

`simctl io recordVideo` 是公开的，今天即可使用。录屏可以作为独立的能力与工具变更在现有提供方上交付，不得排在 helper 之后。

## 备选方案

**在 `dsh-ios-sim-simctl` 上扩展 `describe` 与 `input`。** 依据实证否决：这些操作在 substrate 上并不存在。subsystem 页面与包 README 已写明这一限制并链接本 Agent Note；记录它是因为曾有一条分支据此前的 simctl-only 读法开工。

**要求用户自行安装 `idb` 二进制并对其 shell out。** 它让 harness 免于原生源码，又复用同一批框架，并在 gate 0 禁止 vendoring 时仍是回退方案。作为主路径被否决：它把一项硬依赖推到每个用户的机器上，把契约绑定到另一个项目的 CLI 文本输出 —— 正是 seam 存在以避免的解析耦合 —— 并且无法承载 phase 4 的视频编码器。

**经由 XCTest 驱动输入。** 公开且受 Apple 支持，但每次交互都是一次测试包的构建与运行：每次点按数秒延迟、一份需要管理的构建产物，且在测试进程之外无法读树。对可交互面板不可用。

**只做坐标输入，与人使用设备的方式一致。** 请求类型更简单，对面板也够用，但它丢弃了 `describe` 已经返回的元素引用，并把模型推回从栅格图上读坐标 —— 正是 level-0 契约正文所要防止的习惯。两种形式的代价不过是请求类型里的一个 union。

**只做元素引用输入，如 level-0 契约正文所述。** 在面板成为输入面之后被否决：对画面的一次点击产生的是一个点，强行走树查找会让人的点按依赖一次可能与他所见不符的新鲜 `describe`。

**推迟流，长期把面板当作查看器。** 最省事，且在输入尚不存在时是诚实的。作为终态被否决：一个画面滞后的输入面比查看器和流都差，因此 phase 3 也就把项目锁定到了 phase 4。


在任何原生源码提交之前，gate 0 已给出书面答案，许可条款与锁定版本已记入 vendor 清单。

Phase 2 完成的标志是：挂载 `dsh-ios-sim-native` 的组合能在两种受支持架构上为一台已启动设备返回可用性树；`unadvertisedCapabilities` 证明该提供方的声明与钩子一致；`SIMULATOR_CAPABILITY_UNAVAILABLE` 在该提供方上仍拒绝 `input` 与 `stream`；并且按[测试政策](../../../../docs/testing.zh.md)，有一条经由真实可运行示例的无密钥快照覆盖一次 `describe` 调用。

Phase 3 完成的标志是：`input` 接受两种目标形式；模型发起的输入追加 `iosSim/action`；面板输入的记录决定已写入本 Agent Note 并已实现；调用中途杀死 helper 会产生具名的监管错误，而不是未处理的 rejection。

Phase 4 完成的标志是：帧率、缩放与编码器是经校验的提供方配置；面板不再呈现任何不改变可观察行为的控件。

每个阶段都在与代码同一次变更中更新 subsystem 页面、受影响的包 README 以及两套 SDK 的预期输出。

## 后果

接缝的十名能力词汇全部得到服务，使 level-0 提供方诚实的同一道 gate 让每次成长都同样诚实：每项能力都带着自己的证明面（describe：树；input：解析后的落点；stream：编码块的流动）。

代价：原生构建矩阵、ad-hoc 签名与一个受监管进程进入了仓库的运行时；vendored 框架源码会相对 Xcode 发布而老化，其私有接口会移动。simctl 提供方作为回退继续挂载 list、launch 与 screenshot，把 helper 损坏的损害限定在已服务的集合。`SESSION_FORMAT_VERSION` 全程保持 `0`——词汇增长，而非结构性日志变更。

## 相关

消费 `stream` 与 `input` 的 GUI 面板另行提案：[模拟器面板 note](../../proposed/architecture/2026-08-27-ios-simulator-panel.zh.md)。
