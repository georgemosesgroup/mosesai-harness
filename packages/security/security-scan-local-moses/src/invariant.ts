/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-security-scan-local-moses`.
 * @module @deepseek-ai/dsh-security-scan-local-moses/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-security-scan-local-moses'

/** Cordis companion plugin name. */
export const name = 'security-scan-local-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: argv construction is a pure whitelist function tested
 * directly, and execution facts (timedOut/aborted/output caps) are returned in
 * every result rather than published as an observation stream.
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
