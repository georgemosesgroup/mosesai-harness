/** Package-owned iOS-simulator tool invariants. @module @deepseek-ai/dsh-tool-ios-sim/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import { isIosSimActionEvent, validateActionEvent } from './event.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-ios-sim'

/** Cordis companion plugin name. */
export const name = 'tool-ios-sim-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Validate one committed session event against this package's durable
 * vocabulary; unrelated events pass untouched.
 */
function validateCommitted(event: SessionEvent, fail: InvariantFailure): void {
  if (!isIosSimActionEvent(event)) return
  validateActionEvent(event.data, fail)
}

/**
 * Every committed and newly appended `iosSim/action` event must carry a
 * complete action record: a known verb, its required facts (target id, list
 * count / bundle id / URL), and for screenshots reference-facts whose bytes
 * already live in the attachment store. This is the durable audit trail's
 * well-formedness contract — replay reconstructs model behavior from it.
 */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  for (const session of ctx.sessions.list()) {
    for (const event of session.snapshotEvents()) validateCommitted(event, fail)
  }
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    validateCommitted((args as [unknown, SessionEvent])[1], fail)
  }, { global: true })
}, { inject: ['sessions'] })

/* jscpd:ignore-start -- package companions share replay-and-dispatch plumbing */

/**
 * Register package ownership of the iosSim/action payload invariants.
 * @param ctx - the composition context.
 * @returns the installed registration's disposer.
 */
export function apply(ctx: Context): Promise<() => void> {
  return Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
}

/* jscpd:ignore-end */
