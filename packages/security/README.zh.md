---
description: "Package map for the security-scanning plane: the capability seam with its enforced target allowlist, the whitelisted-argv local provider, and the model-facing scan tool."
kind: "package-group"
---

# security/ — 安全扫描控制平面

[English](README.md) | 中文

## 概述

security 组在两道结构性授权边界之后运行由模型驱动的漏洞扫描：哪些目标在范围之内，以及哪些 CLI 标志可以抵达扫描器二进制。seam 在自己的运行时内、任何 provider 查找之前就强制目标允许清单；本地 provider 拥有按扫描器划分的白名单表，使标志注入不可表达，而不只是被禁止。先从 seam 和本地 provider 起步，再加上把一个扫描动词投影给模型的工具。本页映射该组；每个包的 README 拥有自己的约定，而 [安全子系统页](../../docs/subsystems/security.zh.md) 是这套受强制词汇的参考。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 | ctx key |
|---|---|---|
| [`security-scan-moses/`](security-scan-moses/README.zh.md) | 定义 `ctx.securityScan` seam：受强制的目标允许清单、provider 选择，以及扫描请求／结果类型 | `ctx.securityScan` |
| [`security-scan-local-moses/`](security-scan-local-moses/README.zh.md) | 基于 `ctx.subprocess` 的本地 provider：按扫描器划分的白名单 argv 表、超时与 spill 上限、PATH 解析 | 注册到 `ctx.securityScan` |
| [`tool-security-scan-moses/`](tool-security-scan-moses/README.zh.md) | 把一个 `security_scan` 工具投影到该 seam 之上，带选项收窄与有界的渲染结果 | `ctx.tools` |

-----

<a id="related-documentation"></a>
## 相关文档

- [安全子系统](../../docs/subsystems/security.zh.md) —— 受强制的目标允许清单、白名单 argv 边界，以及 provider 选择。

<a id="dev-note"></a>
## 开发备注

None.
