/** Node-half placeholder invariant for the simulator panel UI plugin. @module @deepseek-ai/dsh-client-ui-simulator/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-simulator'

/** Cordis companion plugin name. */
export const name = 'ui-simulator-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the plugin contributes a browser-side view whose
 * correctness (WS lifecycle, decode fallback, stream stop) lives entirely in
 * the browser half and is verified there; no host-plane event or data
 * relationship exists to watch live.
 */
const install: InvariantInstaller = Object.assign((_ctx: Context, _fail: InvariantFailure) => {}, {
  inject: [] as const,
})

/**
 * Register package ownership of the simulator panel UI surface.
 * @param ctx - the composition context.
 * @returns the installed registration's disposer.
 */
export function apply(ctx: Context): Promise<() => void> {
  return Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
}
