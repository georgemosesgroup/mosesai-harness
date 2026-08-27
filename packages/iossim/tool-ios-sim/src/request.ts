/**
 * Shared request-shaping helper for the sim_* tools.
 * @module @deepseek-ai/dsh-tool-ios-sim/request
 */

import { SimulatorId } from '@deepseek-ai/dsh-ios-sim'

/**
 * Resolve an optional model-supplied device token. Empty/whitespace strings
 * mean "let the provider resolve" — its explicit target-resolution step owns
 * that defaulting, not the tool layer.
 *
 * @param raw - the raw `device` argument.
 * @returns a branded reference, or undefined for provider-side resolution.
 */
export function requestedDevice(raw: string | undefined): SimulatorId | undefined {
  const token = raw?.trim()
  return token === undefined || token.length === 0 ? undefined : SimulatorId(token)
}
