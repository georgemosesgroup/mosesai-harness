/**
 * DIF Explorer browser half: contributes the read-only explorer tab into the
 * session view ring and registers its dictionaries. All Remote access stays
 * inside this apply closure; the envelope fold happens here once, so the
 * component callbacks receive plain promises of business results.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
// The generated Remote contribution this plugin mounts itself: the client
// bundle inlines it, which is what the purity gate's /remote rule exists for.
import difExplorerRemote from '@deepseek-ai/dsh-dif-explorer/remote'
// Type-only: the module that declares ctx.remote. The difExplorer namespace
// merges in through the contribution imported above, so this plugin owns both
// halves of its own wire surface and no shared assembly names it.
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { DifExplorerView } from './DifExplorerView.tsx'
import { dicts, NS } from './locales.ts'
import type { DifExplorerKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** DIF Explorer viewer copy. */
    'difExplorer': DifExplorerKey
  }
}

/**
 * Services required for slot registration, dictionaries, and mounting.
 * `remote.difExplorer` is absent here by construction — this plugin mounts
 * that namespace, so waiting on it at plugin level would wait on its own
 * effect. The code that reads it declares it in a nested scope instead.
 */
export const inject = ['slots', 'locale', 'remote']

/** Unwrap one Remote envelope: failures reject with the carrier's message. */
function unwrap<T>(call: Promise<RemoteResult<T>>): Promise<T> {
  return call.then((receipt) => {
    if (receipt.ok) return receipt.value
    throw new Error(receipt.error.message)
  })
}

/**
 * Client plugin body: mount the Remote namespace, register dictionaries, and
 * mount the view-tab entry.
 * @param ctx - client root context.
 * @returns the disposer that unmounts the Remote namespace.
 */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const unmount = await ctx.remote.$mount(difExplorerRemote)
  ctx.effect(() => ctx.locale.register(NS, dicts), 'ui-dif-explorer: dictionaries')
  const t = ctx.locale.bind(NS)
  // Mounting a namespace does not grant access to it: Cordis refuses the
  // `remote.difExplorer` property read unless the reading code declares it.
  // The nested scope is that declaration, and the mount above is what settles
  // it — which is why the declaration cannot sit on this plugin instead.
  ctx.inject(['remote.difExplorer'], (scope: ClientContext) => {
    scope.slots.inject('conversation.view', () => scope.slots.register({
      name: 'conversation.view',
      id: 'dif-explorer',
      order: 20,
      locale: NS,
      label: () => t('view.label'),
      inject: () => ({
        api: {
          listRoots: () => unwrap(scope.remote.difExplorer.listRoots()),
          listTree: (rootId: string) => unwrap(scope.remote.difExplorer.listTree({ rootId })),
          listChanges: (
            rootId: string,
            kind: 'session' | 'worktree' | 'commit',
            sessionId?: string,
          ) => unwrap(scope.remote.difExplorer.listChanges(
            sessionId === undefined ? { rootId, kind } : { rootId, kind, sessionId },
          )),
          getFileContent: (rootId: string, path: string, rev?: string | null) =>
            unwrap(scope.remote.difExplorer.getFileContent(
              rev === undefined ? { rootId, path } : { rootId, path, rev },
            )),
          getDiff: request => unwrap(scope.remote.difExplorer.getDiff(request)),
        },
      }),
    }, DifExplorerView))
  })
  return unmount
}
