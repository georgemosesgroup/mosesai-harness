/**
 * The two Moses AI marks. The wave leads the interface — a single stroked
 * crest curling into an eye, drawn on a 24x18 canvas so it drops into the
 * shell's mark slots without disturbing their layout. The spiral is the
 * application icon: three arms on a square 24x24 canvas, which reads at
 * launcher and dock sizes where the wave's long tail would not.
 *
 * Both ride `currentColor`, so one definition serves light and dark themes.
 */

/** Presentation the host surface requests of a mark. */
export interface MarkProps {
  /** Width in px; height follows the mark's own ratio. */
  size?: number | undefined
  /** Extra class for layout placement. */
  className?: string | undefined
}

/** Path data of the wave crest, on the 24x18 canvas. */
export const WAVE_PATH
  = 'M1.8 15.6C4.5 15.6 5.9 13.7 6.7 10.7C8.1 5.5 11.3 1.6 16 1.6C19.9 1.6 22.3 4.5 22.3 8'
  + 'C22.3 11 20.3 13 18 13C16 13 14.6 11.5 14.6 9.7C14.6 8.2 15.7 7.1 17 7.1'

/** Path data of the three spiral arms, on the 24x24 canvas. */
export const SPIRAL_PATHS: readonly string[] = [
  'M12.75 12.46C13.16 13.18 12.54 14.66 11.00 14.89C9.45 15.13 7.24 13.82 6.79 11.38'
  + 'C6.35 8.95 8.01 5.67 11.27 4.61C14.54 3.56 19.10 5.13 21.13 9.03',
  'M11.22 12.42C10.39 12.42 9.42 11.14 10.00 9.68C10.57 8.23 12.81 6.97 15.14 7.80'
  + 'C17.47 8.63 19.48 11.71 18.76 15.06C18.04 18.42 14.40 21.58 10.00 21.39',
  'M12.02 11.12C12.44 10.40 14.03 10.20 15.01 11.42C15.98 12.64 15.96 15.22 14.07 16.82'
  + 'C12.18 18.42 8.51 18.62 5.97 16.32C3.43 14.02 2.50 9.28 4.87 5.58',
]

/**
 * Render the wave mark.
 * @param props - host-supplied presentation.
 * @returns the mark svg (aria-hidden; the wordmark beside it carries the name).
 */
export function WaveMark({ size = 24, className }: MarkProps) {
  return (
    <svg
      width={size}
      height={(size * 18) / 24}
      className={className}
      viewBox="0 0 24 18"
      fill="none"
      aria-hidden="true"
    >
      <path d={WAVE_PATH} stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" />
    </svg>
  )
}

/**
 * Render the spiral mark.
 * @param props - host-supplied presentation.
 * @returns the square mark svg (aria-hidden).
 */
export function SpiralMark({ size = 24, className }: MarkProps) {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <g stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" fill="none">
        {SPIRAL_PATHS.map(d => <path key={d} d={d} />)}
      </g>
    </svg>
  )
}
