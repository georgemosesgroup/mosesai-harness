/**
 * Geometry of the Moses AI mark, shared by the browser mark and the served
 * application icon so the two cannot drift apart.
 *
 * The mark is an arevakhach, the Armenian eternity sign: eight rays winding
 * out of one centre, their backs closing the outline into a circle, so the
 * figure reads as a disc rather than as separate arms.
 *
 * Only one ray is stated. The other seven are that same path turned about the
 * canvas centre, which is what eight-fold rotational symmetry means — eight
 * literal copies would carry eight times the bytes and could drift apart.
 *
 * A ray's half-width tracks its radius, so the gaps between neighbours hold a
 * constant share of the circle instead of closing up near the centre, where
 * equal-width arms would run into each other and fill the middle solid.
 */

/** Canvas edge in user units. The mark is centred on half of it. */
const CANVAS = 50

/** The square canvas both surfaces draw the mark on. */
export const MARK_VIEWBOX = `0 0 ${CANVAS} ${CANVAS}`

/** One ray, from the centre out to its rounded tip at the rim. */
export const ETERNITY_RAY
  = 'M26.3 25.3C26.4 25.5 26.6 25.6 26.7 25.8C26.8 26.1 26.8 26.3 26.8 26.7C26.8 27.0 26.8 27.4 26.7 27.8C26.5 28.2 26.4 28.6 26.0 29.1C25.7 29.5 25.3 30.0 24.8 30.5C24.2 30.9 23.5 31.4 22.7 31.7C21.8 32.1 20.8 32.4 19.6 32.5C18.4 32.6 17.1 32.7 15.4 32.4C13.8 32.1 11.2 30.6 9.7 30.5C8.2 30.4 6.9 31.0 6.2 31.8C5.5 32.6 5.2 34.5 5.5 35.5C5.9 36.5 6.8 37.5 8.4 37.9C10.0 38.3 13.1 38.3 15.2 38.2C17.2 38.0 19.1 37.4 20.7 36.8C22.2 36.2 23.4 35.4 24.4 34.7C25.4 33.9 26.1 33.0 26.7 32.2C27.3 31.4 27.6 30.6 27.8 29.9C28.1 29.2 28.1 28.6 28.2 28.0C28.2 27.4 28.1 26.9 28.0 26.5C27.9 26.1 27.7 25.7 27.6 25.4C27.4 25.1 27.3 24.9 27.1 24.7C27.0 24.6 26.8 24.5 26.7 24.5C26.5 24.5 26.3 24.6 26.3 24.8C26.2 24.9 26.2 25.1 26.3 25.3Z'

/** Turns in degrees that carry the single ray around the circle. */
export const ETERNITY_TURNS: readonly number[] = [0, 45, 90, 135, 180, 225, 270, 315]

/**
 * Place a ray at one turn of the rosette.
 * @param turn - degrees from the stated ray.
 * @returns the SVG transform, rotating about the canvas centre.
 */
export function rayTransform(turn: number): string {
  return `rotate(${turn} ${CANVAS / 2} ${CANVAS / 2})`
}
