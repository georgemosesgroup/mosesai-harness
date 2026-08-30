# @deepseek-ai/iossim-helper

[English](README.md) | 中文

预编译 `iossim-helper` 原生 helper 之上的 JavaScript seam：这个 entry 包为当前运行的宿主解析出二进制，并拥有提供方所讲的那套协议常量，因此消费方不必硬写路径或帧版本。

```js
import { HELPER_FAILURE_EXIT, HELPER_PROTOCOL_VERSION, helperPath } from '@deepseek-ai/iossim-helper';

const helper = helperPath();
// Spawn it, then read the unsolicited hello frame: a version other than
// HELPER_PROTOCOL_VERSION means refuse the helper rather than guess.
```

二进制与这些常量在同一个包家族内一起版本化，因此提供方不会落后于它所拉起的 helper。策略留在消费方：本包不知道 `describe` 是什么，只知道二进制在哪、讲的是哪个协议版本。helper 在每一次 helper 级致命失败——错误 argv、不可写 stdout、无法序列化的帧——都以 `HELPER_FAILURE_EXIT`（`70`）退出；当提供方关闭 stdin 而它干净排空时，以 `0` 退出。

本模块有意不提供任何环境变量覆盖。哪个二进制服务模拟器操作，绝不能由周围环境决定；测试注入走的是提供方显式的 helper 路径配置。

平台包（由 `os`／`cpu` 选中的可选依赖，内部不含 JavaScript）：`@deepseek-ai/iossim-helper-darwin-arm64`、`@deepseek-ai/iossim-helper-darwin-x64`。在没有对应平台包的宿主上，`helperPath()` 返回一个位于本包边界之内、必然不存在的确定性路径——存在与否不做检查，因为提供方的拉起尝试是唯一的可用性信号，缺失的二进制必须与损坏的二进制以完全相同的方式失败。

helper 的协议格式（wire format）与构建方式记录在 [workspace README](../../README.zh.md) 中。
