/**
 * The browser-facing brand assets: the application icon and the web manifest
 * that names it. Both are served from this package rather than from the
 * shell's `public/` directory, so the upstream files stay untouched and a
 * rebrand is one plugin row.
 *
 * The icon draws the same figure as the browser mark from the same shared
 * geometry, so the tab, the dock, and the sidebar cannot disagree.
 */

import { ETERNITY_RAY, ETERNITY_TURNS, MARK_VIEWBOX, rayTransform } from './eternity.ts'

/**
 * The application icon. `currentColor` cannot reach a favicon, so the dark
 * variant is a media query inside the document: a browser in dark mode paints
 * the rays light, everything else paints them dark.
 */
export const BRAND_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50" viewBox="${MARK_VIEWBOX}">
<style>@media (prefers-color-scheme: dark) { path { fill: #fff } }</style>
<g fill="#000">
${ETERNITY_TURNS.map(turn => `<path d="${ETERNITY_RAY}" transform="${rayTransform(turn)}"/>`).join('\n')}
</g>
</svg>
`

/** Pathname the icon is served from. */
export const BRAND_ICON_PATH = '/brand/icon.svg'

/** Pathname the manifest is served from. */
export const BRAND_MANIFEST_PATH = '/brand/manifest.webmanifest'

/** The web manifest, naming the icon by its served path. */
export const BRAND_MANIFEST = `${JSON.stringify({
  id: '/',
  name: 'Moses AI',
  short_name: 'Moses',
  start_url: '/',
  scope: '/',
  display: 'fullscreen',
  icons: [{ src: BRAND_ICON_PATH, sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
}, null, 2)}\n`
