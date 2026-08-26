/**
 * DIF Explorer browser half: contributes the read-only explorer tab into the
 * session view ring and registers its dictionaries. All Remote access stays
 * inside this apply closure; the envelope fold happens here once, so the
 * component callbacks receive plain promises of business results.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
// Type-only: pulls ctx.remote merge + wire vocabulary through the assembly.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
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

/** Services required for slot registration, dictionaries, and Remote calls. */
export const inject = ['slots', 'locale', 'remote', 'remote.difExplorer']

/** Unwrap one Remote envelope: failures reject with the carrier's message. */
function unwrap<T>(call: Promise<RemoteResult<T>>): Promise<T> {
  return call.then((receipt) => {
    if (receipt.ok) return receipt.value
    throw new Error(receipt.error.message)
  })
}

/**
 * Client plugin body: register dictionaries and mount the view-tab entry.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, dicts), 'ui-dif-explorer: dictionaries')
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'dif-explorer',
    order: 20,
    locale: NS,
    label: () => t('view.label'),
    inject: () => ({
      api: {
        listRoots: () => unwrap(ctx.remote.difExplorer.listRoots()),
        listTree: (rootId: string) => unwrap(ctx.remote.difExplorer.listTree({ rootId })),
        listChanges: (
          rootId: string,
          kind: 'session' | 'worktree' | 'commit',
          sessionId?: string,
        ) => unwrap(ctx.remote.difExplorer.listChanges(
          sessionId === undefined ? { rootId, kind } : { rootId, kind, sessionId },
        )),
        getFileContent: (rootId: string, path: string, rev?: string | null) =>
          unwrap(ctx.remote.difExplorer.getFileContent(
            rev === undefined ? { rootId, path } : { rootId, path, rev },
          )),
        getDiff: request => unwrap(ctx.remote.difExplorer.getDiff(request)),
      },
    }),
  }, DifExplorerView))
}
