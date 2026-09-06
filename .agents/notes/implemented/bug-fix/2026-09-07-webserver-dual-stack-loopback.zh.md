# Agent Note: Web 服务器的双栈回环监听

Status: implemented

[English](2026-09-07-webserver-dual-stack-loopback.md) | 中文

## Problem

`dsh-host-webserver` 只绑定 `127.0.0.1`，其 `host` schema 在回环一侧不接受其他值。Chrome 会把每个 `*.localhost` 名称先解析为 `::1`，再解析为 `127.0.0.1`。HTTP 请求会回退到 IPv4 并成功，但 `new WebSocket('ws://name.localhost:port/api/remote.mux')` 报告 `ERR_CONNECTION_REFUSED`，且从不在另一地址族上重试。因此通过 `--trusted-host` 在此类名称下提供 Web 应用的部署能加载页面，随后却失去网关流，客户端启动审计把 `sessions` 的每个消费者都报告为待定。`--host ::1` 会被配置校验拒绝，而 `0.0.0.0` 仍然只绑定 IPv4，因此没有任何启动标志能触及 IPv6 回环。

## Decision

`Config.loopbackFamilies` 字段（`'ipv4' | 'dual'`，默认 `ipv4`）选择回环姿态监听的地址族。在 `dual` 下，服务在 `127.0.0.1` 监听器之后，用该监听器获得的端口再绑定一个 `::1` 上的 `node:http` 服务器，因此 OS 分配的端口被共享。两个服务器运行同一组 request 与 upgrade 监听器；拆卸时关闭两者以及被跟踪的已升级 socket。`host` 联合类型保持为 `'127.0.0.1' | '0.0.0.0'`，因此 `ctx.webServer.host` 对目录选择器与 LAN 信任解析器而言仍然表示绑定姿态。

错误配置在最早的点失败：`dual` 与 `0.0.0.0` 组合在构造函数中抛出；`::1` 绑定失败会让 `[Service.init]` 拒绝，从而使 fiber 失败而不是只服务一个地址族。随附的 Web bundle 保持默认值；部署通过其补丁层选择启用。

## Alternatives considered

**把 `'::1'` 加入 `host` 联合类型。** 被拒绝，因为每个消费者都通过将 `host` 与 `'127.0.0.1'` 比较来检测回环姿态；仅 IPv6 的绑定还会失去 `127.0.0.1` 客户端。

**绑定 `'::'` 实现双栈。** 被拒绝，因为 `::` 是全接口绑定，其 `IPV6_V6ONLY` 语义因平台而异；它会悄然把回环姿态变成网络开放。

**默认启用 `dual`。** 被拒绝，因为没有 IPv6 回环的主机与容器会激活失败；默认值保留现有绑定，选择启用只需一个配置键。

**让客户端为 WebSocket 回退到 IPv4。** 被拒绝，因为 WebSocket 的地址选择由浏览器拥有；页面无法挑选地址族。

## Consequences

`*.localhost` 名称下的受信主机部署只需在 webserver 行加一个键即可获得可用的 WebSocket upgrade。在 `dual` 下服务拥有两个监听器，代价是多一个 socket 以及拆卸时的第二次 `close()`。`ipv4` 默认值使每个现有组合保持不变。

包测试固定了默认的仅 IPv4 绑定、`dual` 下两个地址族的 HTTP 与 upgrade 绑定、两个监听器的拆卸、`0.0.0.0` 的拒绝，以及 `::1` 的 `EADDRINUSE` 激活失败。webserver 源码不在逐文件覆盖率门禁之内；真实 Loader 组合测试即为证据。
