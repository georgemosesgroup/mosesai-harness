---
description: "基于安全扫描接缝的模型可见 security_scan 工具，持有 schema、提示词指引、预算与呈现，而接缝负责授权与执行。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-security-scan-moses

[English](README.md) | 中文

<a id="summary"></a>
## 概述

基于 [`dsh-security-scan-moses`](../security-scan-moses/README.zh.md) 的模型可见 `security_scan` 工具。本包持有 schema、提示词指引、预算与呈现；seam 负责授权、提供方选择与执行。扫描器二进制缺失时工具依旧可见，并在执行期以结构化 seam 错误失败（`tool-web` 先例）。

## 目录

- [工具](#the-tool)
- [配置](#config)
- [Model Experience](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="the-tool"></a>
## 工具

- `scanner` — 已启用扫描器的枚举（按配置过滤的 nuclei/httpx/katana/ffuf/nmap/sqlmap 子集）。
- `targets` — URL 或 `host[:port]` 字符串数组；每个主机都必须在本部署 allowlist 内。
- `options` — 开放对象；值在此边界收窄为 string/number/boolean/string 数组，越界之后由提供方的逐扫描器白名单校验。原始 argv 无法表达。

规范结果携带实际执行的 argv、退出事实（`exitCode`/`signal`）、成因标记（`timedOut`/`aborted`）、时长，以及带截断与 spill 路径的两路捕获流。渲染输出为单文本段，整体在已知后截断到 `maxOutputChars`（默认 20000）并附截断 footer。

<a id="config"></a>
## 配置

`scanners`（逐 id 启停）、`timeoutMs`（600000）作为 `ToolDefinition.timeoutMs` 附着，以及 `maxOutputChars`（20000）。扫描声明 `isConcurrencySafe: false`，兄弟调用围绕其串行。

### Enablement

把三个包挂进任意组合 patch 层。以用户 web profile 为例，写入 `$DSH_HOME/profiles/web/cordis.patch.yml`：

```yaml
- insert:
    - id: security-scan
      name: '@deepseek-ai/dsh-security-scan-moses'
      config:
        allowlist: ['staging.example.com']

    - id: security-scan-local
      name: '@deepseek-ai/dsh-security-scan-local-moses'

    - id: tool-security-scan
      name: '@deepseek-ai/dsh-tool-security-scan-moses'
```

用 `dsh --profile web --dump-config | grep security-scan` 验证；新创建的会话中即出现该工具。

<a id="model-experience"></a>
## Model Experience

### 请求上下文与条件

#### What the model sees

一个 `tool:security_scan` 系统提示词 section（order 112），声明扫描仅针对用户自有资源（部署 allowlist 即授权边界，范围外目标直接失败），推荐 httpx → nuclei → 定点工具的顺序以及 sqlmap 优先 staging 的用法；另有 [tool catalog](../../../docs/tool-catalog.zh.md) 中 `security_scan` 的 schema 条目。

##### 本字段的逐字文本

```markdown
security_scan runs authorized vulnerability scans against resources OWNED by the user (the deployment allowlist is the authorization boundary — targets outside it fail). Recommended order: httpx to confirm live hosts, nuclei for broad templated checks, then targeted tools for specific questions. Run sqlmap only on an explicit task and prefer staging copies of applications; always pass a short note via options when relevant.
```

#### Token 效果

固定：插件挂载期间每个 agent 请求一次性增加约 90 token 的 section，schema 追加其目录体量的条目；配置中禁用全部扫描器时两者都不注册。

#### KV Cache 效果

会话内追加且前缀稳定，组合不变即不变；重载本插件或编辑 `scanners`/提示词文本会在下一次请求替换该前缀片段。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

- **仅白名单选项** — 冻结白名单之外的扫描器旗标完全无法传入；放宽即是有意为之的代码变更。
- **独占执行** — 扫描绝不加入并行兄弟组；重度扇出需等待。
- **无后台模式** — 长扫描受工具协作超时约束；`ctx.jobs` producer 暂缓。
- **结构化错误而非静默跳过** — 二进制不可用以执行期 `SECURITY_PROVIDER_UNAVAILABLE` 呈现，而不是隐藏工具。

<a id="dev-note"></a>
### 开发备注

无。
