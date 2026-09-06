# Agent Note: 在优先解析为 IPv6 的主机名下 Web 启动审计失败

Status: proposed

[English](2026-09-07-web-boot-audit-under-ipv6-first-hostname.md) | 中文

## Problem

通过 `http://dsh.localhost:4650/`（经 `--trusted-host` 放行的 `*.localhost` 名称）打开 Web 应用时，每次页面加载都会抛出 `web boot: 22 entries did not activate`，而同一服务器以 `http://127.0.0.1:4650/` 打开则正常启动。报告列出了所有传递依赖 `sessions` 的客户端条目，链条的根是 `@deepseek-ai/dsh-api-session-controller: pending (waiting for service: fileUpload)`。`@deepseek-ai/dsh-client-file-upload` 条目不在报告中，说明其 Loader 条目已激活，但在审计时 `ctx.get('fileUpload')` 仍为 `undefined`。

观察到的宿主侧差异在传输层，而非插件名册。`dsh-host-webserver` 只监听 `127.0.0.1`（IPv4）。Chrome 将 `dsh.localhost` 先解析为 `::1`，再解析为 `127.0.0.1`；HTTP 请求会回退到 IPv4，但网关流 `new WebSocket(ws://dsh.localhost:4650/api/remote.mux)` 报告 `ERR_CONNECTION_REFUSED`，且 `[connection] connection lost, retry #N` 持续累加。`packages/client/web/src/boot.ts` 中的启动审计紧跟在 `loader.await()` 之后运行，并把尚未提供的服务视为永久失败，因此仍在重试的传输层被当成启动错误，尽管页面随后仍渲染出侧边栏、会话和输入框。

在选定修复方案前，仍有两个事实需要查明：为何拥有 `fileUpload` 的条目已激活而服务缺失（`Service` 基类在构造时注册，因此要么嵌套 fiber 尚未启动，要么 `ctx.get` 读取了另一个作用域）；以及在 `assertEntriesActive` 抛出后是哪条路径挂载了应用，因为该路径会跳过 `mountApp`，且 `BootPage.fail` 应当把失败报告留在屏幕上。

## Proposal

1. **双栈回环绑定。** 当 `dsh-host-webserver` 配置为回环主机时，同时监听 `::1` 与 `127.0.0.1`（双栈回环），或明确记录 `*.localhost` 名称要求 `--host` 指定 IPv6 回环。无论审计如何，这都消除了被拒绝的 WebSocket。目前不存在启动时的绕过方案：`Config.host` 的 schema 是封闭联合 `'127.0.0.1' | '0.0.0.0'`，因此 `--host ::1` 在加载时就无法通过配置校验，而 `0.0.0.0` 仍然只绑定 IPv4。
2. **让审计等待传输层。** `runPluginBoot` 在 `assertEntriesActive` 之前等待网关流首次进入已连接状态（或有界的重试预算），使审计度量的是插件健康而非网络时序。
3. **把传输层报告为原因。** 若审计时流仍未连接，启动报告应指出失败的 WebSocket URL 与错误，而不是派生出的待定消费者列表。
4. **固定失败时的挂载路径。** 要么失败路径不得挂载应用，要么应用挂载后必须移除 `BootPage.fail`；当前行为同时呈现控制台错误与可用页面。

## Alternatives considered

- **去掉审计。** 会失去 0.1.3 合并后捕获过期打包名册的显式失败信号，当时 `fileUpload` 是真正缺失的。
- **只记录使用 `127.0.0.1`。** 受信主机部署的意义正是服务一个具名 authority，且 iOS 模拟器面板的防护已接受该 authority；在同一名称下让 WebSocket 一半失效属于半成品功能。
- **在 `session-controller` 内部重试。** 消费者会用自身时序掩盖传输层故障；连接层已经拥有重试逻辑，审计应当咨询的是它。

## Acceptance criteria

- 以 `--trusted-host` 在 `*.localhost` 名称下打开 Web 应用时，控制台没有 `web boot:` 错误，也没有 `remote.mux` 连接失败；在 `127.0.0.1` 与 `localhost` 下同样成立。
- 一个无密钥客户端测试用延迟连接的流驱动启动并断言审计通过；配套用例用永不连接的流断言报告指出传输层。
- 上述未解问题在 implemented 记录中给出答案：审计时哪个 fiber 拥有 `fileUpload`，以及审计失败后哪条路径挂载了应用。

## Risks

双栈回环改变了请求信任防护与面板防护所比较的绑定地址；两者都必须把 `[::1]` 视为回环。等待传输层会让真正不可达的服务器的启动延后一个重试预算，因此预算必须短且被报告。
