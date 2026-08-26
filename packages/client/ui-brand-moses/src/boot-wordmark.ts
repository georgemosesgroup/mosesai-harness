/**
 * The boot screen's wordmark, restated for this brand.
 *
 * `dsh-client-web` builds that screen in plain JavaScript before any plugin
 * loads and writes its wordmark as a literal, so there is no slot to occupy
 * and no build-time value to set — the only seam that reaches it is the
 * document itself. This row swaps the glyphs in CSS: the element keeps its
 * own font, weight, tracking, and color token, while its text is replaced by
 * generated content.
 *
 * The selector is structural because the class name is content-hashed per
 * build. `[data-dsh-boot]` is a stable data attribute the boot root sets, and
 * the wordmark is the first child of the card inside it. If a future shell
 * reorders that card, the rule stops matching and the upstream wordmark shows
 * through — a visible fallback rather than a broken screen.
 */

import type { IndexInjection } from '@deepseek-ai/dsh-host-webserver'

/** Text the boot screen shows in place of the upstream wordmark. */
export const BOOT_WORDMARK = 'MOSES AI'

/** The wordmark override as a head style row. */
export function bootWordmarkInjection(text: string = BOOT_WORDMARK): IndexInjection {
  return {
    kind: 'style',
    text: `[data-dsh-boot] > div > div:first-child { font-size: 0 !important }
[data-dsh-boot] > div > div:first-child::after { content: ${JSON.stringify(text)}; font-size: 16px }`,
  }
}
