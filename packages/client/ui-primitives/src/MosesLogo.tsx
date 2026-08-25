// Moses AI wave mark: one stroked wave whose crest curls into an eye, drawn on
// a 24x18 canvas so it drops into the fish mark's layout slots unchanged.
// Native 24x18, rendered 24x18 by default; hero usage scales to 34x25.5. Color
// rides currentColor (wordmark ink).

import type { IconProps } from './icons/props.ts'

/**
 * Render the wave logo.
 * @param props.size - width in px (default 24; height keeps the 24:18 ratio).
 * @param props.className - extra class for layout placement.
 * @returns the logo svg (aria-hidden; pair with the wordmark for accessibility).
 */
export function MosesLogo({ size = 24, className }: IconProps) {
  return (
    <svg
      width={size}
      height={(size * 18) / 24}
      className={className}
      viewBox="0 0 24 18"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M1.8 15.6C4.5 15.6 5.9 13.7 6.7 10.7C8.1 5.5 11.3 1.6 16 1.6C19.9 1.6 22.3 4.5 22.3 8C22.3 11 20.3 13 18 13C16 13 14.6 11.5 14.6 9.7C14.6 8.2 15.7 7.1 17 7.1"
        stroke="currentColor"
        strokeWidth="2.8"
        strokeLinecap="round"
      />
    </svg>
  )
}
