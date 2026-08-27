# dsh-ios-sim-simctl

[English](README.md) | 中文

基于公开 `xcrun simctl` 表面的 iOS 模拟接缝 Level-0 Service Provider——不用 idb、不用可用性树、不用视频。一切通过 [`ctx.subprocess`](../../subprocess/subprocess/README.zh.md) 以严格 argv 数组派生；子命令字经过固定 `SIMCTL_ALLOWLIST`（`list, boot, shutdown, install, launch, terminate, openurl, io`），之后的参数只能来自类型化请求字段，绝不拼插调用方文本（[dif-explorer git-run 先例](../../host/dif-explorer/src/gitrun.ts)）。

不同的失败对应不同的修复：

| 情形 | 代码 | 提示方向 |
|---|---|---|
| 无 Xcode 选择 / 目录布局残缺 | `SIMULATOR_XCODE_NOT_RESOLVED` | 安装 Xcode；用 `sudo xcode-select -s …` 重选 |
| 本执行世界找不到 `xcrun` | `SIMULATOR_XCODE_NOT_RESOLVED` | 命令行工具 / 组合的 subprocess 世界 |
| 有 Xcode 但缺 iPhoneOS.platform | `SIMULATOR_IOS_SDK_MISSING` | 安装 iOS 平台组件 |
| 未知设备 id | `SIMULATOR_DEVICE_NOT_FOUND` | 先调用列表动词，原样使用 id |
| 自动指定目标却无已启动设备 | `SIMULATOR_DEVICE_NOT_BOOTED` | 先启动模拟器 |
| 多台已启动且未指名 | `SIMULATOR_TARGET_AMBIGUOUS` | 显式传入 id |
| simctl 非零退出 | `SIMCTL_SUBCOMMAND_FAILED` | stderr 尾部 |
| 触发允许列表拒绝 | `SIMCTL_ALLOWLIST_REJECTED` | 仅固定词汇 |
| 超过时限 | `SIMCTL_TIMEOUT` | 配置的预算 |

显式默认：每次底层调用都经过公开的 `resolve(request): SimctlInvocationSpec`——填充启动器路径、校验后的开发者目录（`xcode-select -p`，探测一次并记忆）、deadline 收敛（config 的默认/上限 + 计时器上限）、捕获预算与工作目录；动词体内不留隐藏回退（[dsh-shell 模板](../../shell/shell/src/index.ts)）。目标解析同理：省略引用时要求恰好一台已启动设备（导出的 `resolveSimulatorTarget`），每种失配都有独立代码。

装载即报错：非 macOS 构造抛出 `SIMULATOR_PLATFORM_UNSUPPORTED`，错误组合在加载期失败而非静默闲置。

声明的能力：`list, boot（含 shutdown）, install, launch, terminate, screenshot, openUrl`。不声明：`describe, input, stream`——未来接缝。

几何诚实：截图是原生栅格；公开表面不提供逻辑点尺寸查询（在当前安装上验证过——profile plist 不含显示尺寸）。因此 launch 结果携带 `GEOMETRY_UNAVAILABLE_NOTE`，绝不猜点数。

## Config

| 字段 | 默认 | 含义 |
|---|---|---|
| `timeoutMs` | 60000 | 单次调用 deadline |
| `maxTimeoutMs` | 600000 | 上限收敛 |
| `maxOutputBytes` | 64000 | stdout/stderr 每流捕获上限 |
| `graceMs` | 3000 | SIGTERM→SIGKILL 升级宽限 |

## Model Experience

Indirectly, through [`dsh-tool-ios-sim`](../tool-ios-sim/README.zh.md) 这样的 Consumer 投影：列表给出名称/状态/runtime，launch 给出 pid 与 bundle 回声，截图给出 PNG 及其像素事实；provider 层零直接 token 成本，Consumer 输出什么（设备表、信封文本）由它自行预算，失败消息给出具体下一步以缩短重试环。

#### KV Cache effect

经 Consumer 会话事件 append-only：成功动作追加很小的 `iosSim/action` 记录（数十 token），早期请求前缀继续复用，新后缀延展缓存而非使其失效。

## Known Limitations and Deferred Work

- **任何动词都不给点几何**——level-0 表面无法为逻辑尺寸背书；phase-2 输入所需坐标将随可用性树 provider 到来。
- **调用之间状态可能过期**——其他角色可在列表后立刻启动/关闭/抹除设备；每个动词都针对新鲜列表重新解析目标，过期答案会带着自己的代码响亮失败。
- **不含部署便利设施**——`install` 需要已有 .app/.ipa 路径；这里不做下载/构建助手。
