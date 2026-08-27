/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-security-scan`.
 * @module @deepseek-ai/dsh-security-scan/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-security-scan-moses'

/** Cordis companion plugin name. */
export const name = 'security-scan-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the provider registry is private and allowlist
 * enforcement happens on every scan call inside the operation that accepts the
 * targets, so there is no independent registry or observation stream to watch.
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
