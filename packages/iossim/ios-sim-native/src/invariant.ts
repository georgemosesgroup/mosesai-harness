/** Package-owned native-provider invariants. @module @deepseek-ai/dsh-ios-sim-native/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-ios-sim-native'

/** Cordis companion plugin name. */
export const name = 'ios-sim-native-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the provider owns no events and no durable state. Its
 * safety-critical relations — the one-capability advertisement, the supervised
 * restart bound with its named exhaustion code, request serialization against
 * the helper's one-at-a-time protocol, and teardown reaching process-tree
 * quiescence — are enforced inside the operations that make them and proven by
 * the package's own suites plus the Service Definition's loud gate; no
 * cross-event or replay relationship exists to watch live.
 */
const install: InvariantInstaller = Object.assign((_ctx: Context, _fail: InvariantFailure) => {}, {
  inject: [] as const,
})

/**
 * Register package ownership of the native-provider surface.
 * @param ctx - the composition context.
 * @returns the installed registration's disposer.
 */
export function apply(ctx: Context): Promise<() => void> {
  return Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
}
