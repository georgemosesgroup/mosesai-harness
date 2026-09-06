# Agent Note: DIF Explorer：受限 Host Remote 之上的只读 workspace 浏览器

Status: implemented


[English](2026-08-27-dif-explorer-read-only-workspace-explorer.md) | 中文

## 问题

Web 端此前无从知晓一个 workspace 里有哪些文件、它的会话或 git 历史改动了什么、一处改动究竟长什么样，除非离开 harness 转去终端。把持久化的 `tool/call` 事件折叠起来，就能得到那些尚未提交到任何地方的编辑的前后对照，而这是 git 自己给不出的。任何这样的表面还必须是严格只读的：路径限定、argv 数组式的 git 允许清单、密钥文件的扣留以及内容掩码都必须落在 Host 一侧，这样任何客户端代码路径都无法改动 workspace 或泄露凭据材料。

## 决策

新增 `@deepseek-ai/dsh-dif-explorer`（Host）与 `@deepseek-ai/dsh-client-ui-dif-explorer`（浏览器），并在 `dsh-client-locale` 中加入俄语支持。Host 网关只暴露一个只读的 `difExplorer` Remote namespace：来自 `ctx.workspaceRegistry` 的 workspace 根、一棵遵守 gitignore 的文件树、跨三种范围的改动账目（从 `ctx.sessionPersistence` 日志折叠出的持久化 agent 会话、未提交的 worktree、近期提交）、按版本寻址的文件内容，以及统一格式的前后 diff。浏览器包贡献一个 `conversation.view` 标签页（Files／Changes 两个面板，外加一个具备统一与分栏两种模式、行内词级高亮和 hunk 跳转快捷键的 diff 查看器）。

`DifExplorerGateway` 继承 `TypertRemoteService`（`namespace difExplorer`），每次调用都经由 `workspaceRegistry` 解析根。文件系统访问一律汇入 `resolveInsideRoot`：先做词法上的限定（因此已删除的路径仍可 diff），再对照 realpath 做一次，以堵住符号链接逃逸。git 只走一套允许清单内的子命令（`status`、`diff`、`log`、`show`、`ls-files`、`rev-parse`、`cat-file`、`name-rev`），以 argv 数组交给 `execFile`，路径置于 `--` 之后；其余一律在 spawn 之前拒绝。会话条目把 `write`／`edit`／`str_replace_editor` 事件折叠成带片段字节数与 hunk 计数的条目；`getDiff` 接受两种模式，文件模式（经 `git show` 取 base／head 版本，用原始字节做二进制判定）或工具调用模式（日志中记录的那对片段）。diff 使用 jsdiff 的 `structuredPatch`，输出行数上限 5000；任一侧超过 1 MiB 时降级为 `--numstat` 统计；`.env`／密钥文件的内容以及已识别的 token 形态，在任何东西上线之前先做掩码。浏览器一侧在自己的 apply 闭包里一次性折叠 `RemoteResult` 信封，因此组件消费的是普通 promise；查看器状态是组件本地的，因为 `conversation.view` 的 slot 约定不携带存储（与 trajectory 条目同一套做法）。

## 后果

这个表面按构造就是只读的：整个包里没有任何写入端点，也没有任何暂存／提交／推送能力，因此客户端代码无法改动 workspace 或泄露凭据材料。所需验证：无密钥的 `pnpm exec vitest run packages/host/dif-explorer packages/client/ui-dif-explorer packages/client/locale`（65 项包测试：hunk 模型含截断与二进制启发式、掩码策略、含符号链接逃逸的路径限定、协议解析、会话折叠、树／模糊匹配模型、分栏与统一视图的装配），且 `pnpm run lint` 与 `pnpm run typecheck` 为绿。在一台真实的 `dsh web` 服务器上针对 `/Volumes/Moses/IT/VideoChain` 做过实机验收：`listRoots` 列出三个根，`listTree` 提供遵守 gitignore 的树，手工制造的新增／编辑／删除分毫不差地出现在 worktree 账目中并给出正确的 +2 hunk diff，验收用的提交带着干净的 ISO 时间戳出现在提交账目中，另一个 DSH 会话记录下的 `edit` 调用出现在会话账目中、工具名为 `Edit` 且经工具调用模式给出正确的片段前后对照，一个 1.2 MB 的文件降级为 `oversized` 统计，而 `../../etc/passwd` 以 `path escapes the workspace root` 被拒。

## 曾考虑的替代方案

- **在 view slot 上放一个存储**来保存已展开的根与选中文件——要让它在标签页卸载后仍能恢复，要么改动 slot 约定并取得跨包的签字，要么做一层运行时投影，对第一个版本而言两者都超出规模；查看器状态保持组件本地，卸载即重置。
- **在 Host 侧做词级 diff**（`diffWordsWithSpace`）——改为在浏览器中按可见的改动对懒执行（模块级缓存），用少量重复计算换取有界的载荷。
- **让会话账目的状态知晓文件是否已存在**——状态只从日志中记录的参数推导（`write` 且没有旧的一侧即意味着 `A`），从不去查该路径此前是否存在；为每一行去访问文件系统，被判定为超出这份账目读取模型的规模而否决。
