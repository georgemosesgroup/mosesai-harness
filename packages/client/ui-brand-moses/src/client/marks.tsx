/**
 * The Moses AI mark as a browser component. The figure and its canvas live in
 * [`../eternity.ts`](../eternity.ts); this module only renders them.
 *
 * The rays ride `currentColor`, so one definition serves light and dark themes
 * and the mark takes the ink of whichever surface slots it.
 */

import { ETERNITY_RAY, ETERNITY_TURNS, MARK_VIEWBOX, rayTransform } from '../eternity.ts'

/** Presentation the host surface requests of a mark. */
export interface MarkProps {
  /** Requested square edge in px. */
  size?: number | undefined
  /** Extra class for layout placement. */
  className?: string | undefined
}

/**
 * Render the eternity mark.
 * @param props - host-supplied presentation.
 * @returns the square mark svg (aria-hidden; the wordmark beside it carries the name).
 */
export function EternityMark({ size = 24, className }: MarkProps) {
  return (
    <svg width={size} height={size} className={className} viewBox={MARK_VIEWBOX} aria-hidden="true">
      <g fill="currentColor">
        {ETERNITY_TURNS.map(turn => <path key={turn} d={ETERNITY_RAY} transform={rayTransform(turn)} />)}
      </g>
    </svg>
  )
}
