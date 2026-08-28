/**
 * Simulator panel browser half: contributes the live-view tab into the
 * session view ring. The component owns its WebSocket; no Remote calls and
 * no session events are involved.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the conversation.view slot declaration into the SlotMap.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { SimulatorPanel } from './SimulatorPanel.tsx'

/** Services required for slot registration. */
export const inject = ['slots']

/**
 * Client plugin body: mount the simulator panel tab.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'simulator',
    order: 30,
    label: () => 'Simulator',
    inject: () => ({}),
  }, SimulatorPanel))
}
