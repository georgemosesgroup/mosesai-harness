/**
 * Simulator panel browser half: contributes the live-view tab into the
 * session view ring and registers its dictionaries. The component owns its
 * WebSocket; no Remote calls and no session events are involved.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the conversation.view slot declaration into the SlotMap.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { SimulatorPanel } from './SimulatorPanel.tsx'
import { dicts, NS } from './locales.ts'
import type { SimulatorKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Simulator panel copy. */
    'simulator': SimulatorKey
  }
}

/** Services required for slot registration and dictionaries. */
export const inject = ['slots', 'locale']

/**
 * Client plugin body: register dictionaries and mount the simulator panel tab.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, dicts), 'ui-simulator: dictionaries')
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'simulator',
    order: 30,
    locale: NS,
    label: () => t('view.label'),
    inject: () => ({}),
  }, SimulatorPanel))
}
