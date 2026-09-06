/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-dif-explorer`.
 * @module @deepseek-ai/dsh-dif-explorer/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-dif-explorer'

/** Cordis companion plugin name. */
export const name = 'dif-explorer-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package owns no mutable state — every Remote
 * method is a side-effect-free read over registries owned elsewhere
 * (workspaceRegistry, sessionPersistence) plus confined disk and git reads,
 * so there is no event/data relation of its own to assert continuously.
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
