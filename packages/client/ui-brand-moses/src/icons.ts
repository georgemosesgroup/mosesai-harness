/**
 * The browser-facing brand assets: the application icon and the web manifest
 * that names it. Both are served from this package rather than from the
 * shell's `public/` directory, so the upstream files stay untouched and a
 * rebrand is one plugin row.
 */

/** Three spiral arms on the 24x24 canvas, scaled to the 50x50 icon viewport. */
const SPIRAL_ARMS: readonly string[] = [
  'M26.6 25.96C26.99 27.46 25.7 30.54 22.9 31.02C20.1 31.5 15.08 28.79 14.15 23.71'
  + 'C13.23 18.64 16.69 11.81 23.48 9.60C30.29 7.42 39.79 10.69 44.02 18.81',
  'M23.4 25.88C21.67 25.88 19.65 23.21 20.86 20.17C22.05 17.15 26.69 14.52 31.54 16.25'
  + 'C36.40 17.98 40.58 24.40 39.08 31.37C37.58 38.37 30.00 44.96 20.83 44.56',
  'M25.04 23.17C25.92 21.67 29.23 21.25 31.27 23.79C33.29 26.33 33.25 31.71 29.31 35.04'
  + 'C25.38 38.38 17.73 38.79 12.44 34.00C7.15 29.21 5.21 19.33 10.15 11.62',
]

/**
 * The application icon. `currentColor` cannot reach a favicon, so the dark
 * variant is a media query inside the document: a browser in dark mode paints
 * the arms light, everything else paints them dark.
 */
export const BRAND_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50" viewBox="0 0 50 50" fill="none">
<style>@media (prefers-color-scheme: dark) { path { stroke: #fff } }</style>
<g stroke="#000" stroke-width="5" stroke-linecap="round" fill="none">
${SPIRAL_ARMS.map(d => `<path d="${d}"/>`).join('\n')}
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
