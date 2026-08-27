# iossim-helper

[English](README.md) | 中文

[`dsh-ios-sim-native` 提供方](../../packages/iossim/ios-sim-native/README.zh.md)背后的原生后台 helper：一个没有用户界面的 macOS 可执行文件，链接 idb 框架（FBSimulatorControl、FBControlCore 及其依赖闭包，按 [vendoring 政策](../../vendor/README.md)以锁定提交vendored 在 `vendor/idb/`），承载公开 `xcrun simctl` 表面无法完成的工作。它今天只承载一项操作——`describe`，设备可用性树——因为在它们承载更多之前，一项能力就是对许可、构建与拉起路径的端到端证明（[所属 Agent Note](../../.agents/notes/proposed/architecture/2026-08-27-ios-simulator-native-provider.zh.md)）。

本 workspace 沿用 [landlock-run](../landlock-run/README.zh.md) 模板：两层 npm 家族、每架构一个构建记录者、二进制以文件路径解析而绝不被 import。

## 协议

标准流上分帧的请求/响应 JSON 交换。提供方以无参数拉起 helper，并经由它先行发言。

- **分帧。** 每帧是 4 字节大端长度前缀，后跟恰好那么多字节的 UTF-8 JSON。超过 64 MiB 的帧被拒绝。
- **Hello。** stdout 上未经请求的第一帧：`{"helper": "iossim-helper", "protocol": 1, "ops": ["describe"]}`。它是拉起证明——提供方等待它、校验协议版本，并拒绝宣布任何其他内容的 helper。没有 `id` 的帧是 hello；此后每帧都带整数 `id`。
- **请求。** `{"id": N, "op": "describe", "params": {"simulatorId": "UDID" | null}}`。省略（null）的 `simulatorId` 按接缝的显式规则对已启动设备解析：必须恰好一台已启动，零台或多台各自以独立代码失败。
- **响应。** 成功：`{"id": N, "ok": true, "result": …}`。失败：`{"id": N, "ok": false, "error": {"code": …, "message": …}}`——`code` 来自模拟器接缝的失败词汇（`SIMULATOR_DEVICE_NOT_FOUND`、`SIMULATOR_TARGET_AMBIGUOUS`……），每次失败跨进程边界仍保有各自的修复路径。
- **describe 结果。** `{simulatorId, root?, screen?, truncated}`——`root` 是最前台应用可用性树的框架自有序列化形态（role、label、identifier、以点为单位的 frame、enabled、children），读取无可报告之物时缺席，`screen` 是已实证的显示尺寸（点），`truncated` 表示读取是否被截断。
- **诊断。** stderr 承载自由文本，永远不是协议。stdout 只是协议，别无其他。
- **生命周期。** stdin 上的 EOF 意味着结束：helper 排干并以 `0` 退出。helper 级致命失败（错误 argv、不可写 stdout）以 `70` 退出；非零退出对提供方的监管而言就是死掉的 helper。helper 不读环境变量、不接受参数——哪个二进制服务模拟器操作，绝不由环境状态决定。

## npm 家族

- **Entry 包**（`@deepseek-ai/iossim-helper`）：ESM TypeScript。拥有路径解析（`helperPath`）与协议常量，提供方因此绝不会落后于它拉起的二进制。把每个平台包列为 `optionalDependency`。
- **平台包**（`@deepseek-ai/iossim-helper-darwin-{arm64,x64}`）：`bin/` 下一个预编译二进制、声明它的 `prebuilds.json`、没有任何 JavaScript。npm 的 `os`/`cpu` 字段在安装时选出匹配者。

平台包不可解析时，`helperPath()` 返回 entry 包自身 `node_modules` 内一个确定性存在与否的路径；提供方的拉起尝试是唯一的可用性信号，与 landlock-run 的 probe 姿态一致。

## 构建与发布模型

`node scripts/build.mjs` 构建运行架构：`xcodegen generate`（自 `project.yml`，它对照 `vendor/idb/` 转写锁定的上游框架目标），随后 `xcodebuild` 把四个静态框架与 helper 编译成一个自包含 Mach-O 二进制（上游所有框架目标都是静态库，可执行文件之外无可分发之物），再安装到 `packages/darwin-<arch>/bin/` 并做功能性验证——新二进制必须发出良构 hello 帧并干净退出。Xcode 是工具链记录者；不存在交叉工具链，CI 的逐架构 macOS runner 构建并证明每个二进制。本地开发采用 ad-hoc 签名，与 vendored 构建配置一致。
