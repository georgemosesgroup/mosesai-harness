/** Package-owned iOS-simulator contract invariants. @module @deepseek-ai/dsh-ios-sim/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-ios-sim'

/** Cordis companion plugin name. */
export const name = 'ios-sim-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package owns only the typed Service Definition —
 * request/result data and capability vocabulary. It produces no events, no
 * durable state, and no mutation stream of its own; the observable runtime
 * relations live in the provider that implements the hooks and the consumer
 * that appends `iosSim/action` events, and those packages prove their own
 * relationships with their own companions.
 */
const install: InvariantInstaller = Object.assign((_ctx: Context, _fail: InvariantFailure) => {}, {
  inject: [] as const,
})

/**
 * Register package ownership of the simulator-seam contract surface.
 * @param ctx - the composition context.
 * @returns the registration disposer.
 */
export function apply(ctx: Context): Promise<() => void> {
  return Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
}
