/** Moses AI occupants for the generic browser-brand slots. */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { MosesBrandMark, MosesBrandName } from './Brand.tsx'

/** Required service: the UI slot registry. */
export const inject = ['slots']

/**
 * Fill every shipped brand slot as one declaration-aware registration set, so
 * the package works whether it activates before or after the sidebar and
 * conversation declarers, and withdraws every occupant together.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', () =>
      ctx.slots.inject('conversation.hero.brand.mark', function* () {
        yield ctx.slots.register({ name: 'sidebar.brand.mark' }, MosesBrandMark)
        yield ctx.slots.register({ name: 'sidebar.brand.name' }, MosesBrandName)
        yield ctx.slots.register({ name: 'conversation.hero.brand.mark' }, MosesBrandMark)
      })))
}
