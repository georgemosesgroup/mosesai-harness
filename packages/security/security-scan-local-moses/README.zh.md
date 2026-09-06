---
description: "安全扫描 seam 的本地 Service Provider：解析已安装的扫描器二进制，按每个扫描器硬编码的选项白名单经 subprocess 接缝运行——绝不经过 shell。"
kind: "package-reference"
---

# @deepseek-ai/dsh-security-scan-local-moses

[English](README.md) | 中文

<a id="summary"></a>
## 概述

安全扫描 seam 的本地 Service Provider：解析已安装的扫描器二进制，按每个扫描器硬编码的选项白名单构建 argv，并经由 [`dsh-subprocess`](../../subprocess/subprocess/README.zh.md) 执行进程——绝不经过 shell。

## 目录

- [一次扫描如何运行](#how-a-scan-runs)
- [配置](#config)
- [Model Experience](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="how-a-scan-runs"></a>
## 一次扫描如何运行

1. `available(scanner)` 检查 `binPaths[scanner]` 是否在盘且可执行，否则沿 `$PATH` 搜索；绝不 spawn。
2. 用 [src/scanners.ts](src/scanners.ts) 规划 argv：选项必须出现在该扫描器的白名单中，整数遵守逐旗标范围，布尔值添加旗标本身，字符串不得以 `-` 开头（防 flag-injection），字符串数组以同样校验后逗号拼接。未知名称抛 `SECURITY_OPTION_UNKNOWN` 并列出允许集合；非法值抛 `SECURITY_OPTION_INVALID`。不存在透传——`extraArgs` 无法表达。
3. 执行使用一个 `deadline()`，把调用方信号与 `timeoutMs`（受 `maxTimeoutMs` 上限）融合；`timedOut`/`aborted` 按第一成因分类，与 bash executor 完全一致。spawn 或运行失败以 `SECURITY_EXEC_FAILED` 附 cause 抛出。

提供方内置的扫描器策略：sqlmap 始终前置 `--batch`（交互不可达）；nuclei 默认 `-json` 与 `-exclude-tags dos`（可覆盖）；ffuf 要求含 `FUZZ` 关键字的 `url` 以及一个 `wordlist`，后者按 `wordlistDirs` 解析或接受已存在的绝对路径。

<a id="config"></a>
## 配置

`binPaths`、`wordlistDirs`、`cwd`（默认 `process.cwd()`）、`timeoutMs`（600000）、`maxTimeoutMs`（3600000——安全扫描合理地很长）、`maxOutputBytes`（64000）、`maxSpillBytes`（64 MiB）、`graceMs`（3000，受 Node 定时器上限约束）。子进程获得终端友好的环境（`NO_COLOR`/`TERM=dumb`/`PAGER=cat`），叠加在 subprocess 服务的清洗基线之上。

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-tool-security-scan-moses`; this provider backend delegates all model rendering to it.

#### KV Cache effect

None; nothing here participates in request assembly or history retention.

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

- **不负责安装二进制** — 提供方从不下载或安装扫描器；缺失的二进制以 `SECURITY_PROVIDER_UNAVAILABLE` 失败。
- **sqlmap 单目标；ffuf 无位置目标** — sqlmap 通过单一 `-u` URL 驱动，ffuf 由其 FUZZ `url` 选项驱动；多目标仅支持位置目标类扫描器（nuclei/httpx/katana/nmap）。
- **仅在 POSIX 上测试** — 单元固定件是 POSIX shell 脚本，CI 覆盖率也在其上运行；Windows 下真实扫描器的执行未经验证。
- **OWASP ZAP 缺席** — 本迭代暂缓 ZAP 提供方；seam 注册表接受未来加入的实现。

<a id="dev-note"></a>
### 开发备注

无。
