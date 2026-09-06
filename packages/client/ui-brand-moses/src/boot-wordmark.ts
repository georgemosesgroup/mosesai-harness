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

/**
 * The window's own top rule.
 *
 * In the installed app there is no browser chrome above the frame, so the
 * first row of the interface sits flush against the title bar. One fixed
 * hairline across the whole viewport puts a boundary there — over the app AND
 * over the browser panel, which is what keeps it from looking like a rule that
 * belongs to one column and stops at its edge.
 *
 * A pseudo-element rather than a border on the body: a border would move the
 * layout by a pixel and hand the page a scrollbar it did not have.
 * @returns the window-rule style injection for the shell index.
 */
export function windowRuleInjection(): IndexInjection {
  return {
    kind: 'style',
    text: `body::before {
  content: '';
  position: fixed;
  inset: 0 0 auto;
  height: 1px;
  background: var(--dsw-alias-border-l2, rgb(255 255 255 / 12%));
  pointer-events: none;
  z-index: 2147483647;
}`,
  }
}

/**
 * The wordmark override as a head style row.
 * @param text - override copy; defaults to the shipped boot wordmark.
 * @returns the style-row index injection replacing the boot wordmark.
 */
export function bootWordmarkInjection(text: string = BOOT_WORDMARK): IndexInjection {
  return {
    kind: 'style',
    text: `[data-dsh-boot] > div > div:first-child { font-size: 0 !important }
[data-dsh-boot] > div > div:first-child::after { content: ${JSON.stringify(text)}; font-size: 16px }`,
  }
}
