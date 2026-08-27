# dsh-ios-sim-native

[English](README.md) | 中文

iOS 模拟器接缝的原生 Service Provider，架在 [`iossim-helper`](../../../native/iossim-helper/README.zh.md) 后台 helper 之上——helper 链接 Meta 的 FBSimulatorControl 与 FBControlCore（MIT，按 [vendoring 政策](../../../vendor/README.md)锁定并源码 vendored），承载公开 `xcrun simctl` 表面在结构上无法完成的工作。它只声明**一项能力——`describe`**，即带稳定元素引用的设备可用性树——因为在它们承载更多之前，一项能力就是对许可、构建、拉起与监管路径的端到端证明（[所属 Agent Note](../../../.agents/notes/proposed/architecture/2026-08-27-ios-simulator-native-provider.zh.md)）。其余每个公开动词都以 `SIMULATOR_CAPABILITY_UNAVAILABLE` 拒绝，`input` 在 phase 3 之前仍是保留的 `Promise<never>`。

不同的失败对应不同的修复：

| 情形 | 代码 | 提示方向 |
|---|---|---|
| 非 macOS 宿主 | `SIMULATOR_PLATFORM_UNSUPPORTED` | 只在 macOS 上挂载本提供方 |
| helper 缺失 / 拉起失败 / 已退出 | `SIMULATOR_HELPER_UNAVAILABLE` | 安装 `@deepseek-ai/iossim-helper` 平台包或设置 `helperPath` |
| hello 帧不符 / 分帧破损 | `SIMULATOR_HELPER_PROTOCOL_BROKEN` | 二进制与 entry 包一同版本化——混合安装 |
| 重启次数耗尽 | `SIMULATOR_HELPER_SUPERVISION_EXHAUSTED` | 检查 helper 安装，再重新挂载 |
| helper 请求超时 | `SIMULATOR_HELPER_TIMEOUT` | 配置的预算 |
| 底层拒绝（目标解析、读取失败） | helper 自带的接缝代码 | message 携带修复方式 |

## Config

| 字段 | 默认 | 含义 |
|---|---|---|
| `helperPath` | entry 包解析 | 显式的 helper 二进制路径——测试注入与自定义安装的逃生口；运行时本身不读环境变量 |
| `timeoutMs` | 60000 | 单次 helper 请求 deadline |
| `maxTimeoutMs` | 600000 | 上限收敛 |
| `maxRestarts` | 3 | 达到具名耗尽失败前的受监管重启次数（按提供方实例累计） |
| `graceMs` | 3000 | 拆除时 SIGTERM→SIGKILL 升级 |

目标解析在 helper 内部运行，它持有 CoreSimulator 设备集绑定：省略引用要求恰好一台已启动设备，零台或多台各自以接缝自身代码失败（`SIMULATOR_DEVICE_NOT_BOOTED`、`SIMULATOR_TARGET_AMBIGUOUS`）。提供方的显式 `resolve(request): NativeInvocationSpec` 规划 helper 路径、deadline 与重启上限——动词体内不留隐藏回退（[dsh-shell 模板](../../shell/shell/src/index.ts)）。

装载即报错：非 macOS 构造抛出 `SIMULATOR_PLATFORM_UNSUPPORTED`，错误组合在加载期失败而非静默闲置。拆除是被等待的：提供方的销毁先关闭 helper 的 stdin（协议的 EOF 即完成），等待干净退出，仅当子进程无视关闭时才升级为进程树终止（[防御性模式](../../../docs/defensive-patterns.zh.md)）。

## Model Experience

### 暂无模型可见表面

#### What the model sees

今天没有：四个 phase-1 工具没有一个路由到本提供方——未声明的动词响亮地门控拒绝——所以本提供方的模型可见表面随 `describe` 消费者到来。服务级消费者拿到可用性树：元素 role、label、substrate 标识、以点为单位的 frame、enabled 状态，以及后续 `input` 调用将点名的索引路径 `reference` 字段。

#### Token effect

describe 结果随最前台应用的元素数伸缩；大树需要消费侧剪枝或键收窄后才进入模型上下文。错误是一行的、指名修复方式的消息。

#### KV Cache effect

本身为零：提供方不追加会话事件，因此从不自行增长 transcript；消费者投影自行负责它记录的内容。

## Known Limitations and Deferred Work

- **一项能力是设计使然**——`list`、`boot` 及其余仍留在 [`dsh-ios-sim-simctl`](../ios-sim-simctl/README.zh.md)；需要两者的组合挂载 simctl 提供方，等待 helper 的能力集成长（phase 3 增加 `input`）。
- **尚无 describe 工具**——四个模型可见工具保持 phase-1 schema；describe 投影是独立的变更（[note 的规划](../../../.agents/notes/proposed/architecture/2026-08-27-ios-simulator-native-provider.zh.md)）。
- **元素引用按次读取有效**——框架不提供跨读取的稳定标识，因此引用是在一次 describe 结果内有效的索引路径；重新 describe 会对活 UI 重新分页。
- **仅限 macOS 且需要 Xcode**——helper 链接所选 Xcode 的 Apple 私有 CoreSimulator/SimulatorKit；没有 Xcode 的宿主无法运行本提供方（simctl 回退对其自身动词响亮降级）。
