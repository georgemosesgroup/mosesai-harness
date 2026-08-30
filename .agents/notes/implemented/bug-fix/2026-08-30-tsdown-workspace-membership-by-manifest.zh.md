# Agent Note: workspace 成员身份由 manifest 决定，而非目录位置

Status: implemented

[English](2026-08-30-tsdown-workspace-membership-by-manifest.md) | 中文

## 问题

`vendor/` 存放的是按 commit 固定的源码副本。在 iOS 模拟器这项工作之前，每一份副本都是 JavaScript 包。`vendor/idb/` 是一份 Objective-C 与 Swift 的源码树切片，没有 `package.json`，而根目录的 `tsdown.config.ts` 用 `vendor/*` 这个 glob 选取构建目标。tsdown 从匹配到的目录逐级向上查找 manifest（元数据清单），因此一个没有 manifest 的目录最终解析到仓库根目录。根项目以 `noEmit: true` 编译，从不写出 `lib/types`，于是根目录自己的入口 glob 无法解析，整个 Host 构建阶段在 Typert 运行之前就失败：

```
ERROR [@deepseek-ai/dsh-root] Cannot find entry: ["lib/types/{index,invariant,startup}.js"]
```

这条报错点名的是仓库根目录，可根目录既不拥有那个选中目录的 glob，也不拥有那份缺少 manifest 的 vendor 源码树，因此报错指向的位置与两个真实成因都无关。

## 决策

根目录的 `tsdown.config.ts` 改为从文件系统推导它的 vendor 构建目标：`vendoredPackages()` 列出 `vendor/`，只保留带 `package.json` 的目录，并排序以获得稳定的构建顺序。`packages/*/*` 与 `apps/cli` 仍用 glob，因为它们匹配到的每个目录按构造就是一个包。

于是成员身份取决于 manifest 是否存在——这正是 tsdown 真正要求的属性——而不再取决于目录处在 `vendor/` 之下的位置。将来再有非 JavaScript 的 vendor 副本加入这棵树时，无需改动这份配置，也不会重新引发这次失败。

## 曾考虑的替代方案

**给 `vendor/idb/` 添加 `package.json`。** 被它会违反的 vendoring 政策否决：[vendor/README.md](../../../../vendor/README.md) 写明 `vendor/idb/` 存放的是未经改动的上游源码树切片，不携带任何本地修改。人造的 manifest 就是一处本地修改，而且还必须再配一份本地 `tsdown.config.ts`，其唯一职责是压制一个该目录从来就没有的入口。

**在 tsdown 的 `exclude` 列表里点名 `vendor/idb`。** 因为它会留下一笔长期欠账而被否决：`exclude` 会替换掉 tsdown 的默认排除集合，四条默认项都得重新写一遍；而下一份非 JavaScript 的 vendor 副本会以同样的方式失败，直到有人想起来扩展这份列表。它产生的报错并不点名肇事目录，因此每一次这样的排查代价都很高。

**把这些 framework 移出 `vendor/`。** 被否决，因为 `vendor/` 是各类固定源码副本的既定归属地，[vendor/README.md](../../../../vendor/README.md) 中的 manifest 也已按 commit 记录了 idb 的固定版本。为了迁就一个 glob 而搬走源码，等于让源码远离管辖它的政策。

## 后果

在包含非 JavaScript vendor 副本的树上，Host 构建阶段能够跑完，从而解开它后面的 Typert 生成、Client 阶段与 Web 构建。配置求值时读取 `vendor/` 的代价是一次目录列举加每个条目一次 `existsSync`，每次调用 tsdown 只付一次。

这份配置现在会在求值期间做文件系统操作，先前的纯字面量写法则不会。这份代价换来的是一条无需维护即可保持正确的规则；那个避开文件系统的方案，正是本节否决的排除列表。

## 测试

在 `vendor/idb/` 存在的树上 `pnpm run build` 能够跑完，记录下 204 份 client 产物。同一棵树换回先前的 glob 就能复现上面的失败；该复现是在无关的工作区改动被 stash 之后做的，正是它确认了这次失败属于既有问题，而非本次引入。
