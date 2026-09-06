/** Package-owned simctl-provider invariants. @module @deepseek-ai/dsh-ios-sim-simctl/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-ios-sim-simctl'

/** Cordis companion plugin name. */
export const name = 'ios-sim-simctl-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the provider owns no events and no durable state. Its
 * safety-critical relations — the argv allowlist, target resolution against a
 * fresh listing, and advertisement↔hook consistency
 * (`unadvertisedCapabilities`) — are enforced inside the operations that make
 * them and proven by the package's own suites plus the Service Definition's
 * loud gate; no cross-event or replay relationship exists to watch live.
 */
const install: InvariantInstaller = Object.assign((_ctx: Context, _fail: InvariantFailure) => {}, {
  inject: [] as const,
})

/**
 * Register package ownership of the simctl-provider surface.
 * @param ctx - the composition context.
 * @returns the installed registration's disposer.
 */
export function apply(ctx: Context): Promise<() => void> {
  return Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
}
