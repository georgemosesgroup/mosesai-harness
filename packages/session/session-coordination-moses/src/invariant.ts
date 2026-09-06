/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-session-coordination-moses`.
 * @module @deepseek-ai/dsh-session-coordination-moses/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-session-coordination-moses'

/** Cordis companion plugin name. */
export const name = 'session-coordination-moses-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: claim state is an in-process store whose TTL sweep,
 * disposal release, and per-write enforcement are exercised directly by the
 * package specs; nothing is published as an independent observation stream.
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
