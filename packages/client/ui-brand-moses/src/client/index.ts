/** Moses AI occupants for the generic browser-brand slots. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { MosesBrandMark, MosesBrandName } from './Brand.tsx'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { ruCommon, ruSettings } from './ru-language-pack.ts'

/** Required service: the UI slot registry. */
export const inject = ['slots', 'locale']

/**
 * Fill every shipped brand slot as one declaration-aware registration set, so
 * the package works whether it activates before or after the sidebar and
 * conversation declarers, and withdraws every occupant together.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  // Russian language pack: the language row lists it, the shared vocabularies
  // translate, and every namespace registered with a ru dictionary follows.
  ctx.effect(() => ctx.locale.addLanguage({ id: 'ru', label: 'Русский', fallback: 'en' }), 'ui-brand-moses: ru language')
  ctx.effect(() => ctx.locale.register('common', 'ru', ruCommon), 'ui-brand-moses: ru common')
  ctx.effect(() => ctx.locale.register('settings.locale', 'ru', ruSettings), 'ui-brand-moses: ru settings')
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', () =>
      ctx.slots.inject('conversation.hero.brand.mark', function* () {
        yield ctx.slots.register({ name: 'sidebar.brand.mark' }, MosesBrandMark)
        yield ctx.slots.register({ name: 'sidebar.brand.name' }, MosesBrandName)
        yield ctx.slots.register({ name: 'conversation.hero.brand.mark' }, MosesBrandMark)
      })))
}
