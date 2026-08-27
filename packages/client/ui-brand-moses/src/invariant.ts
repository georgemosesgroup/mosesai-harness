/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-brand-moses`.
 * @module @deepseek-ai/dsh-client-ui-brand-moses/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-brand-moses'

/** Cordis companion plugin name. */
export const name = 'client-ui-brand-moses-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the package retains no mutable state. Its browser half
 * installs three slot occupants through one transactional effect, and its node
 * half owns two immutable assets plus one pure index transform, all of which
 * leave with the fiber that registered them.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
