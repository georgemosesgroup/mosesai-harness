/**
 * Package-owned panel-bridge invariants. @module @deepseek-ai/dsh-ios-sim-panel/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-ios-sim-panel'

/** Cordis companion plugin name. */
export const name = 'ios-sim-panel-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the bridge owns no durable state and appends no
 * session events. Its safety-critical relations — the trust fence on every
 * upgrade, one stream per socket, stop-on-dispose reaching the substrate,
 * and pump termination when a socket or handle dies — are enforced inside
 * the bridge and proven by the package's own suites; no cross-event or
 * replay relationship exists to watch live.
 */
const install: InvariantInstaller = Object.assign((_ctx: Context, _fail: InvariantFailure) => {}, {
  inject: [] as const,
})

/**
 * Register package ownership of the panel bridge surface.
 * @param ctx - the composition context.
 * @returns the installed registration's disposer.
 */
export function apply(ctx: Context): Promise<() => void> {
  return Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
}
