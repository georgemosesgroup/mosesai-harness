# Agent Note: 插件自己拥有 Remote 的挂载与启用

Status: implemented

[English](2026-08-30-plugins-mount-their-own-remote-namespace.md) | 中文

## 问题

一个新增 Typert Remote 的插件，过去只有被写进 [`packages/api/remotes/src/client/index.ts`](../../../../packages/api/remotes/src/client/index.ts) 才能抵达浏览器：导入它生成的 `/remote` contribution、在挂载循环里加一项、再把它的协议格式（wire format）词汇重新导出一遍。那份文件属于共享的 Client assembly，因此一个在上游主线之外开发的插件，仅仅为了存在就得改动一份上游文件。

这笔代价每次更新都要付。把上游 1079 个 commit 合并进这棵树会产生 41 个冲突文件，这份 assembly 就是其中之一——不是因为两边在任何事情上有分歧，而是因为双方都往同一份列表里加了行。今后每加一个插件、每做一次合并，这个冲突都会重来一次，而且在有人读完它之前，它和一次真正的分歧毫无区别。

## 决策

拥有某个 Remote namespace 的插件自己挂载它。它的 Client 一侧导入自己生成的 contribution，并在 `apply` 内调用 `ctx.remote.$mount()`：

```ts ignore-check
import difExplorerRemote from '@deepseek-ai/dsh-dif-explorer/remote'

export const inject = ['slots', 'locale', 'remote']

export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const unmount = await ctx.remote.$mount(difExplorerRemote)
  // dictionary and slot registration
  return unmount
}
```

有三项性质决定了这就是 assembly 原本执行的那个操作，而不是它旁边的另一条路径：

`$mount` 本就是 assembly 自己的机制。它遍历所列 contribution 的循环调用的正是这个方法；该方法在 `ctx.remote` 上是公开的，并通过 `ctx.effect()` 把自己的 disposer（资源释放）绑定到调用方的 fiber 上。一个插件挂载一份 contribution 与一份 assembly 挂载十二份，差别只在数量。

client bundle 的纯净度门禁认可这次导入。[`packages/client/tsdown.client.ts`](../../../../packages/client/tsdown.client.ts) 中的 `GENERATED_REMOTE` 按模式而非按包的白名单，放行对任意 `<package>/remote` 说明符的值导入，并在注释里写明了意图：一份 wire contribution 本就该被内联。其余所有跨插件的值导入依旧禁止。

`inject` 不列出插件自己挂载的那个 namespace。inject 列表里的 `remote.difExplorer` 会等待该 namespace 出现；而挂载它的插件这样写就会等待自己的 effect。真正为两者定序的，是任何注册动作之前对 `$mount` 的 await，因此那些经由 `ctx.remote.difExplorer` 发起调用的 slot 回调不可能在它落定之前运行。

这处省略是对 [API Gateway 文档](../../../../docs/api-gateway.zh.md) 中那条规则的有意偏离：该规则把 namespace 依赖判给读取 `ctx.remote.<namespace>` 的那个包，并且不让只做挂载的 assembly 声明它。这条规则假定两者是不同的包；在这里它们是同一个包，而规则背后的理由得到了比声明本身更强的满足。一处声明出来的依赖，说的是必须有另一个插件先把该 namespace 挂上；而所有权让这件事变得无条件，因为唯一能挂载或卸载它的代码，就是调用它的那同一个 `apply`。

assembly 保留真正共享的部分：`$on` 从中选取的转发事件白名单，以及让一份 Client contribution 得以称呼另一个包所拥有类型的 wire 词汇重新导出。一个 Remote 只承载调用的插件，两者都不需要。

## 启用随插件一起走

同一条所有权规则也决定组合方式。插件不再被列进 [`packages/bundle/web-app/cordis.patch.yml`](../../../../packages/bundle/web-app/cordis.patch.yml)；它在自己的目录下随包提供 `enablement/web-profile.cordis.patch.yml`，其中装着挂载它所需的 `insert` 行。一个 profile 通过 `--patch` 应用该文件，或者由操作者把这些行复制进 `$DSH_HOME/profiles/<name>/cordis.patch.yml`，再从该 profile 的 manifest 里 link 这些包——[profile 约定](../../../../packages/boot/app-boot/README.zh.md#profiles)中的层序把这两者都排在每一层组合包之上。

这个做法就是 [`tool-security-scan-moses`](../../../../packages/security/tool-security-scan-moses/README.zh.md) 已经在用的那个；DIF Explorer 沿用它，而不是再发明第二种被组合进来的方式。它的两行放在同一份文件里，因为两个平面各自都不成立：Host 网关回答浏览器标签页发出的调用，而标签页挂载这些调用所途经的那个 namespace。

由此带来的结果是，随产品发布的 `web` 组合包不再携带这个插件，因此一个没有点名它的 profile 就不会拥有它。这正是本意——组合包描述的是产品自身的组合，而在那条主线之外开发的插件，陈述自己的组合。

## 曾考虑的替代方案

**继续把插件列进 Client assembly。** 因为它正是本记录要消除的那笔代价而被否决：每次合并一个冲突文件，随插件数量增长，且不携带任何关于真正改了什么的信息。它还让一个插件能否存在取决于是否改动一份自己并不拥有的文件，而这正是插件架构存在的意义所在——避免这种耦合。

**请上游为这份 assembly 提供一个注册 seam。** 因是多余的工作而被否决：`$mount` 本身已经是那个 seam，纯净度门禁也已经为它所需的导入放行。新加一个 API 只会重复一个一步之遥的公开方法。

**把组合行留在 `web-app` 组合包里。** 与列进 assembly 出于同样的理由被否决，另加一条：组合包的 patch 陈述的是随产品发布的组合，因此其中的一行等于宣称该插件属于那个产品。它并不属于，而这个宣称在每一次触及该文件的合并中都得重新做一遍。

**fork `api/remotes` 并维护一份分叉的 assembly。** 因为它兼取两者之弊而被否决：它把一个反复出现的行级冲突变成反复出现的整文件合并，还把共享的 wire 词汇的一份副本置于本地所有权之下，使其与它所投影的 Host 声明发生漂移。

## 后果

[`packages/api/remotes`](../../../../packages/api/remotes/README.zh.md)——它的 Client assembly、manifest 与 Client tsconfig——连同 `web-app` 组合包的 patch 与 manifest，都与上游逐字节一致，因此曾与上游产生分歧的文件中有五份被永久消除，而不是每次合并再解决一遍。

contribution 被内联进执行挂载那个包的浏览器 bundle，同时把它的依赖闭包一并带入。`ui-dif-explorer` 的 client bundle 正因如此携带了 `zod`，体积为 217.11 kB 原始、43.75 kB gzip 之后。第二个挂载第二份 contribution 的插件要为自己那份副本付费；先前 assembly 的单一 bundle 把这笔开销摊在了所有插件身上。这就是本决策用来换取独立性的那笔交易，它随 fork 自有的 Remote namespace 数量增长，而不随它们的体积增长。

`apply` 返回 disposer，使该 namespace 的生命周期归属插件自己：卸载插件即卸载该 namespace；而在此之前，因为 assembly 拥有它，该 namespace 会比它的每一个消费方都活得更久。

## 测试

在 assembly 已恢复为上游版本的前提下，`tsc -b tsconfig.client.json` 在 Client 面上不报错；假如 namespace 的类型依赖的是 assembly 而不是那次 contribution 导入，正是这项检查会失败。`ui-dif-explorer` 的浏览器 bundle 能穿过纯净度门禁完成构建；假如 `/remote` 的值导入未被放行，正是这项检查会失败。`pnpm run build` 端到端跑完。

本次改动没有用测试覆盖已挂载 namespace 的运行时行为；面板只经过手工验证。经由一个真实可运行示例的无密钥快照仍然欠着。
