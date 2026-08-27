/**
 * Cross-boundary ids branded by this package ([policy](../../../../AGENTS.md#conventions)):
 * the iOS-simulator seam passes device references between providers and
 * consumers that have no other shared structure, so a bare string would let a
 * session id pass where a device id belongs.
 * @module @deepseek-ai/dsh-ios-sim/brand
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** A specific CoreSimulator device reference (its UDID in current providers). */
export type SimulatorId = Branded<'SimulatorId'>

/**
 * Brand a raw device-reference string into a {@link SimulatorId}.
 * @param value - the provider's opaque device-reference text (a UDID today).
 * @returns the branded id; runtime behavior is identical to the input string.
 */
export function SimulatorId(value: string): SimulatorId {
  return value as SimulatorId
}
