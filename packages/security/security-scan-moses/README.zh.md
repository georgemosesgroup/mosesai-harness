---
description: "安全扫描 capability seam 的 Service Definition（`ctx.securityScan`）：提供方注册表加上强制执行的目标 allowlist 授权边界。"
kind: "package-reference"
---

# @deepseek-ai/dsh-security-scan-moses

[English](README.md) | 中文

<a id="summary"></a>
## 概述

安全扫描 capability seam（`ctx.securityScan`）的 Service Definition：提供方注册表 + 强制执行的目标 allowlist。拥有者把 seam 指向自己被授权测试的系统；allowlist 就是授权边界，强制执行发生在接收 targets 的操作内部，因此直接调用服务无法绕过。

## 目录

- [服务](#the-service)
- [配置](#config)
- [Allowlist 语义](#allowlist-semantics)
- [扩展点](#extension-points)
- [Model Experience](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="the-service"></a>
## 服务

`SecurityScanRuntime` 以 `ctx.securityScan` 发布：

- `registerProvider(provider)` — 注册 `SecurityScanProvider`；重复 id 抛出 `SECURITY_DUPLICATE_PROVIDER`。返回 effect 域的 disposer。
- `scan(request, signal?)` — 规范化并去重 `targets`，按 `maxTargetsPerScan` 限数，拒绝任何不在 allowlist 内的主机（`SECURITY_TARGET_NOT_ALLOWLISTED`，消息含该主机），再为 `request.scanner` 选择提供方并转发 `{ ...request, targets }`。

选择语义与 [`dsh-web`](../../web/web/README.zh.md) 一致：配置的 id 未注册 → `SECURITY_PROVIDER_CONFIGURED_MISSING`；已注册但不可用 → `SECURITY_PROVIDER_CONFIGURED_UNAVAILABLE`；未配置时恰好一个可用者即选中，多个可用抛 `SECURITY_PROVIDER_AMBIGUOUS`，零个抛 `SECURITY_PROVIDER_UNAVAILABLE`。可用性按所请求的 scanner 单独询问。

<a id="config"></a>
## 配置

- `allowlist`（必填）— 授权条目；为空或非法在加载期失败（`SECURITY_ALLOWLIST_EMPTY` / `SECURITY_ALLOWLIST_ENTRY_INVALID`，后者标注元素序号）。
- `maxTargetsPerScan` — 默认 8。
- `provider` — 可选的固定提供方 id。

<a id="allowlist-semantics"></a>
## Allowlist 语义

条目授权的是主机。端口不参与授权：允许的主机在任意端口、任意 scheme 下都可达。

- `example.com`、`www.example.com` — 精确匹配该主机；不覆盖子域。
- `.example.com` — apex 及任意深度子域。
- IPv4 / IPv6 字面量 — 精确匹配该地址。
- `10.0.0.0/24`、`2001:db8::/32` — CIDR 段，按位实现且无新依赖。非规范网络地址（主机位非零，如 `10.0.0.5/24`)会被拒绝而非归一化。

目标经 `new URL(...)` 或 `host[:port]` 形态规范化：小写、去括号与结尾点、剥端口。携带 userinfo（`user@host`）的目标直接拒绝（`SECURITY_TARGET_INVALID`）。纯函数（`parseAllowlistEntry`、`normalizeTarget`、`targetAllowed`）位于 [src/allowlist.ts](src/allowlist.ts) 并导出供测试使用。

<a id="extension-points"></a>
## 扩展点

部署通过 `registerProvider` 追加可达性——远程沙箱、代理执行机等——而 allowlist 边界始终保留在 seam 内。

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-tool-security-scan-moses`; this seam enforces target authorization and delegates all model rendering to it.

#### KV Cache effect

None; nothing here participates in request assembly or history retention.

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

- **不支持 IDN** — 非 ASCII 主机在解析期被拒；服务 IDN 域名的部署请改用其 punycode ASCII 形式。
- **端口不可授权** — 列表内的主机在所有端口可达；刻意不提供按端口的语法。
- **Session 事件暂缓** — 扫描不追加专门的会话日志事件；当前可观测性即工具结果本身。
- **动态 allowlist 暂缓** — 列表仅来自组合配置；基于 settings 的热更新路径留待后续。
- **后台扫描暂缓** — 长扫描运行在消费方的协作超时内；`ctx.jobs` producer 属未来工作。

<a id="dev-note"></a>
### 开发备注

无。
