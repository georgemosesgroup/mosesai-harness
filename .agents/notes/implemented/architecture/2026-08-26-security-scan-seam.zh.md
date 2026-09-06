# Agent Note: security-scan 能力 seam

Status: implemented

[English](2026-08-26-security-scan-seam.md) | 中文

## 问题

由模型驱动的漏洞扫描器是一项双重用途能力：审计所有者自己 staging 主机的那把工具，同样可以攻击别人的主机。有两项授权决定必须落在结构里而不是流程里——哪些目标在范围之内，以及哪些 CLI 标志可以抵达扫描器二进制。每项决定安放在何处，决定了直接调用服务的一方、将来的消费方或新的提供方能否绕过它。

## 决策

目标授权在 `SecurityScanRuntime.scan` 内部执行——规范化、去重、限定数量、匹配——发生在任何提供方查找或选择之前。匹配器是纯的、无依赖的（`src/allowlist.ts`）：精确主机、`.domain`、IPv4／IPv6 字面量、按位比较的 CIDR v4+v6，并拒绝非规范网络地址（置了主机位就拒绝该条目，而不是把它规范化）。端口按设计置于授权之外：一台被允许的主机在任何端口上都可达，因为按端口划分的授权会招致复制粘贴式的范围扩大，却并不约束真正的威胁（未授权的主机）。

CLI 标志绝不来自模型。本地提供方拥有按扫描器划分的白名单表以及带类型的取值规则；取值不得以 `-` 开头，数组按同一条规则以逗号连接渲染，且不存在任何透传字段，因此标志注入是不可表达的，而不只是被禁止的。各扫描器不可商量的固定项就放在这些表旁边：sqlmap 总是收到 `--batch`，nuclei 默认 `-json`／`-exclude-tags dos`，ffuf 要求一个带 `FUZZ` 的 url 外加一份已解析的字典。

提供方选择与 `ctx.web` 完全一致（先看配置的 id，缺失与不可用给出各自不同的错误；否则要求恰好一个可用，再否则给出歧义／不可用），并按每个被请求的扫描器分别询问。

## 已解决的规格缺口

冻结下来的配置只列了 `allowlist` 与 `maxTargetsPerScan`，而错误分类体系里却带着 `SECURITY_PROVIDER_CONFIGURED_MISSING/_UNAVAILABLE`。这两个分支需要一个配置好的 id，于是运行时配置增加了 `provider?: string`。没有它，这两个分支不可达，覆盖率门禁也就无法通过；这个字段同时给多提供方部署提供了 web seam 已有的那种显式控制。

## 曾考虑的替代方案

- 在工具层做强制——不予采纳：当前和将来的每一个消费方（SDK 脚本、jobs 生产者、其他工具）都得把这道关卡重新实现一遍，或者干脆跳过。
- 在提供方一侧做授权——不予采纳：这会让检查按后端数量成倍增加，并且要指望每一个新提供方都记得做。
- 自由形式的 argv 加提示词层面的引导——不予采纳：引导无法保证什么东西最终抵达 `execve`，白名单表可以。

## 测试

- 允许清单表、选择分支、spy 冷验证的强制、资源释放：`packages/security/security-scan-moses/tests/security-scan.spec.ts`。
- 桩二进制执行、注入、超时／中止分类、spill 上限、PATH 解析：`packages/security/security-scan-local-moses/tests/security-scan-local.spec.ts`。
- 渲染上限边界与选项收窄：`packages/security/tool-security-scan-moses/tests/tool-security-scan.spec.ts`。
- 在真实子进程服务之上装配起来的 loader 启动：`packages/security/tool-security-scan-moses/tests/composition.e2e.ts`。
- 经脚本化适配器驱动一个真实轮次的无密钥 transcript（文本记录）快照：`examples/headless-agent/tests/snapshots/security-scan/`。

## 后果

在任何挂载了这个 seam 的组合中，扫描一台未授权主机都不可能做到；代价是彻底拒绝 IDN 名称（只接受 ASCII／punycode），以及只认白名单内的选项：表之外的扫描器标志按设计需要改代码。新增提示词段落的完整请求头字节固定归 ACP 快照通道所有，而它的录制需要提供方密钥；headless 通道固定的是装配后的 transcript。
