/**
 * Moses AI brand plugin, node half. It serves the application icon and the
 * web manifest, then repoints the shell's own `<link>` elements at them.
 *
 * The repoint is a `tapIndex` transform rather than an `IndexInjection` row on
 * purpose: a row can only ADD markup to the head, and a second `rel="icon"`
 * beside the shipped one leaves the choice to the browser. Rewriting the
 * existing hrefs is the only way to state the answer once.
 */

import type { ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { bootWordmarkInjection, windowRuleInjection } from './boot-wordmark.ts'
import {
  BRAND_ICON_PATH, BRAND_ICON_SVG, BRAND_MANIFEST, BRAND_MANIFEST_PATH,
} from './icons.ts'

export { BRAND_ICON_PATH, BRAND_ICON_SVG, BRAND_MANIFEST, BRAND_MANIFEST_PATH } from './icons.ts'
export { BOOT_WORDMARK, bootWordmarkInjection, windowRuleInjection } from './boot-wordmark.ts'

/** Cordis plugin name. */
export const name = 'client-ui-brand-moses'

/** Service required before any route or index transform can register. */
export const inject = ['webServer']

/** Serve one immutable text asset. */
function textAsset(body: string, type: string): (req: unknown, res: ServerResponse) => void {
  return (_req: unknown, res: ServerResponse) => {
    res.writeHead(200, {
      'content-type': type,
      // The bytes change only when this package does, and the shell is
      // reloaded on every rebuild anyway, so a short cache is enough to keep
      // a tab switch from refetching while never serving a stale rebrand.
      'cache-control': 'max-age=60',
    })
    res.end(body)
  }
}

/**
 * Point one `<link rel="...">` at a new href, leaving the rest of the tag as
 * the shell wrote it. A shell that stops shipping the element yields the html
 * unchanged rather than a duplicated tag.
 */
function repointLink(html: string, rel: string, href: string): string {
  return html.replace(
    new RegExp(`(<link[^>]*\\srel="${rel}"[^>]*\\shref=")[^"]*(")`, 'i'),
    `$1${href}$2`,
  )
}

/**
 * Serve the brand assets and repoint the shell's icon and manifest links.
 * @param ctx - Host context carrying the web server.
 */
export function apply(ctx: Context): void {
  ctx.webServer.register({
    kind: 'exact',
    path: BRAND_ICON_PATH,
    handler: textAsset(BRAND_ICON_SVG, 'image/svg+xml; charset=utf-8'),
  })
  ctx.webServer.register({
    kind: 'exact',
    path: BRAND_MANIFEST_PATH,
    handler: textAsset(BRAND_MANIFEST, 'application/manifest+json; charset=utf-8'),
  })
  ctx.on('webserver/index-inject', (table) => {
    table.push(bootWordmarkInjection())
    table.push(windowRuleInjection())
  })
  ctx.webServer.tapIndex(html =>
    repointLink(repointLink(html, 'icon', BRAND_ICON_PATH), 'manifest', BRAND_MANIFEST_PATH))
}
