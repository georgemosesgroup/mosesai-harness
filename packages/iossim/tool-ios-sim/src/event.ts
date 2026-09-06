/**
 * The `iosSim/action` session-event surface: declaration merge, payload
 * validation shared by the invariant companion, and the one append helper the
 * tools use AFTER their substrate work succeeded.
 * @module @deepseek-ai/dsh-tool-ios-sim/event
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import type { IosSimActionEventData } from './types.ts'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * One simulator action this agent performed through the iosSimulator
     * tools: which verb ran (`action`), against which resolved device
     * (udid/name), plus the result facts each action family owns — list size,
     * launched bundle/pid, opened URL, or the committed screenshot's durable
     * attachment facts. Log-only UI/audit state: derived history ignores it;
     * replay reads it to reconstruct what the model did to devices outside
     * the workspace. Image bytes never ride here — only reference fields
     * already committed through `ctx.attachments`.
     */
    'iosSim/action': IosSimActionEventData
  }
}

/** The complete action set an `iosSim/action` payload may carry. */
export const IOS_SIM_ACTIONS: ReadonlySet<IosSimActionEventData['action']> = new Set([
  'list',
  'launch',
  'openurl',
  'screenshot',
  'describe',
  'input',
])

/**
 * Validate one event payload before it reaches the durable log / on replay.
 * Pure, so the invariant companion and any future writer share ONE definition.
 * @param data - the raw payload appended with type 'iosSim/action'.
 * @param fail - reporter of the enclosing invariant.
 */
export function validateActionEvent(data: unknown, fail: (message: string) => void): void {
  if (typeof data !== 'object' || data === null) {
    fail('iosSim/action payload must be an object')
    return
  }
  const record = data as Record<string, unknown>
  if (!IOS_SIM_ACTIONS.has(record.action as IosSimActionEventData['action'])) {
    fail(`iosSim/action carries unknown action ${JSON.stringify(record.action)}`)
    return
  }
  if (record.action !== 'list' && (typeof record.simulatorId !== 'string' || record.simulatorId.length === 0)) {
    fail(`iosSim/action ${String(record.action)} needs a non-empty simulatorId`)
    return
  }
  switch (record.action) {
    case 'list':
      if (typeof record.devices !== 'number' || !Number.isInteger(record.devices) || record.devices < 0) {
        fail('iosSim/action list needs a non-negative integer devices count')
      }
      break
    case 'launch':
      if (typeof record.bundleId !== 'string' || record.bundleId.length === 0) fail('iosSim/action launch needs bundleId')
      if (record.pid !== undefined && (typeof record.pid !== 'number' || !Number.isInteger(record.pid))) {
        fail('iosSim/action launch pid must be an integer when present')
      }
      break
    case 'openurl':
      if (typeof record.url !== 'string' || record.url.length === 0) fail('iosSim/action openurl needs url')
      break
    case 'screenshot':
      validateImageFacts(record.image, fail)
      break
    case 'describe':
      if (typeof record.elements !== 'number' || !Number.isInteger(record.elements) || record.elements < 0) {
        fail('iosSim/action describe needs a non-negative integer elements count')
      }
      break
    case 'input':
      if (record.inputAction !== undefined && !['tap', 'swipe', 'key', 'text'].includes(record.inputAction as string)) {
        fail(`iosSim/action input carries unknown inputAction ${JSON.stringify(record.inputAction)}`)
      }
      if (typeof record.target !== 'string' || record.target.length === 0) {
        fail('iosSim/action input needs the target descriptor it acted on')
      }
      break
    default:
      fail('unreachable') // closed by IOS_SIM_ACTIONS above
  }
}

function validateImageFacts(image: unknown, fail: (message: string) => void): void {
  if (typeof image !== 'object' || image === null) {
    fail('iosSim/action screenshot must carry image facts')
    return
  }
  const facts = image as Record<string, unknown>
  if (typeof facts.attachmentId !== 'string' || facts.attachmentId.length === 0) {
    fail('iosSim/action screenshot image needs attachmentId')
  }
  for (const key of ['bytes', 'width', 'height'] as const) {
    const value = facts[key]
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
      fail(`iosSim/action screenshot image ${key} must be a positive integer`)
    }
  }
  if (typeof facts.mediaType !== 'string' || facts.mediaType.length === 0) {
    fail('iosSim/action screenshot image needs mediaType')
  }
}

/** Narrow one committed event to this vocabulary; unrelated types return false fast. */
export function isIosSimActionEvent(event: SessionEvent): boolean {
  return event.type === 'iosSim/action'
}

/**
 * Append one action record to the calling agent's session log — called after
 * the substrate work succeeded and, for screenshots, after
 * `attachments.saveImage` durably committed its bytes.
 *
 * @param ctx - plugin context (used only by direct dispatches with no agent).
 * @param exec - the tool-execution context supplying the owning agent.
 * @param data - the validated payload.
 */
export function recordIosSimAction(ctx: Context, exec: ToolExecution, data: IosSimActionEventData): void {
  const session = exec.agent?.session ?? ctx.get('agents')?.currentInitiator()?.session
  if (session === undefined) {
    // Direct dispatches without any owning session cannot append anywhere;
    // refusing beats silently dropping the durable action record.
    throw new Error('iosSim tools require an owning agent session to record actions')
  }
  session.append('iosSim/action', data)
}
