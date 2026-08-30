/**
 * The `sim_input` tool: the model's input surface — tap, swipe, key, and
 * text entry — acting either on an element reference a preceding
 * `sim_describe` issued or on a point in device coordinates.
 * @module @deepseek-ai/dsh-tool-ios-sim/input
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { IosSimulator, SimulatorInputAction, SimulatorInputTarget } from '@deepseek-ai/dsh-ios-sim'
import { recordIosSimAction } from './event.ts'
import { requestedDevice } from './request.ts'
import type { SimulatorInputValue } from './types.ts'

/** Tool-argument shape, flat by wire convention; cross-field semantics live in {@link buildAction}. */
interface SimInputArgs {
  action?: unknown
  device?: unknown
  button?: unknown
  reference?: unknown
  x?: unknown
  y?: unknown
  startX?: unknown
  startY?: unknown
  endX?: unknown
  endY?: unknown
  duration?: unknown
  usage?: unknown
  text?: unknown
}

/**
 * Build the seam's target from the tool's flat arguments. A half-filled
 * combination is a caller mistake: the thrown message names the repair and
 * the tool result surfaces it — the seam's failure classes stay reserved for
 * substrate failures.
 * @throws {Error} when neither an element reference nor a numeric point is present.
 */
function buildTarget(args: SimInputArgs): SimulatorInputTarget {
  if (typeof args.reference === 'string' && args.reference.length > 0) {
    return { kind: 'element', reference: args.reference }
  }
  if (typeof args.x === 'number' && Number.isFinite(args.x) && typeof args.y === 'number' && Number.isFinite(args.y)) {
    return { kind: 'point', at: { xPoints: args.x, yPoints: args.y } }
  }
  throw new Error('sim_input needs a target: an element `reference` from a preceding sim_describe, or numeric `x`/`y` in device points')
}

/** Build one gesture from the tool's flat arguments, rejecting half-filled combinations. */
function buildAction(args: SimInputArgs): SimulatorInputAction {
  switch (args.action) {
    case 'tap':
      return { kind: 'tap', target: buildTarget(args) }
    case 'text':
      if (typeof args.text !== 'string' || args.text.length === 0) {
        throw new Error('sim_input text needs the `text` to set on the target element')
      }
      return { kind: 'text', target: buildTarget(args), text: args.text }
    case 'swipe':
      if (typeof args.startX !== 'number' || !Number.isFinite(args.startX)
        || typeof args.startY !== 'number' || !Number.isFinite(args.startY)
        || typeof args.endX !== 'number' || !Number.isFinite(args.endX)
        || typeof args.endY !== 'number' || !Number.isFinite(args.endY)) {
        throw new Error('sim_input swipe needs numeric `startX`/`startY`/`endX`/`endY` in device points')
      }
      return {
        kind: 'swipe',
        start: { xPoints: args.startX, yPoints: args.startY },
        end: { xPoints: args.endX, yPoints: args.endY },
        ...(typeof args.duration === 'number' && Number.isFinite(args.duration) ? { durationMs: args.duration } : {}),
      }
    case 'key':
      if (typeof args.usage !== 'number' || !Number.isInteger(args.usage) || args.usage < 0 || args.usage > 0xFFFF) {
        throw new Error('sim_input key needs an integer HID `usage` code between 0 and 65535')
      }
      return { kind: 'key', usage: args.usage }
    case 'button': {
      const known = ['home', 'lock', 'side_button', 'siri', 'apple_pay', 'play_pause'] as const
      const button = known.find(name => name === args.button)
      if (button === undefined) {
        throw new Error(`sim_input button needs \`button\`: one of ${known.join(', ')}`)
      }
      return { kind: 'button', button }
    }
    default:
      throw new Error('sim_input needs `action`: one of tap, swipe, key, text, button')
  }
}

/** Describe the target the way the audit record names it — never the text typed. */
function targetDescriptor(args: SimInputArgs): string {
  if (typeof args.reference === 'string' && args.reference.length > 0) return `element ${args.reference}`
  if (typeof args.x === 'number' && typeof args.y === 'number') return `point ${String(args.x)},${String(args.y)}`
  if (typeof args.startX === 'number' && typeof args.startY === 'number') return `from ${String(args.startX)},${String(args.startY)}`
  return 'device'
}

/**
 * Register `sim_input`.
 * @param ctx - composition context carrying the tools registry.
 * @param simulators - the mounted simulator provider to call through.
 */
export function registerSimInputTool(ctx: Context, simulators: IosSimulator): void {
  ctx.tools.register(defineTool({
    name: 'sim_input',
    description: 'Perform one input gesture on an iOS simulator: `tap` (by element `reference` from a preceding '
      + 'sim_describe, or by `x`/`y` in device points), `swipe` (start/end points), `key` (HID usage code), or '
      + '`text` (set a value on the target element), or `button` (a hardware button by name). Element references are only valid against the references '
      + 'the last sim_describe issued; a re-describe repaginates a live UI. Omitting `device` auto-targets the '
      + 'single booted simulator when exactly one exists.',
    parameters: {
      action: {
        type: 'string',
        enum: ['tap', 'swipe', 'key', 'text', 'button'],
        required: true,
        description: 'The gesture to perform.',
      },
      device: { type: 'string', description: 'Simulator id from sim_list; omitted means the single booted simulator.' },
      reference: { type: 'string', description: 'Element reference from sim_describe (`tap`/`text` targets).' },
      x: { type: 'number', description: 'Target x in device points (`tap`/`text` by point).' },
      y: { type: 'number', description: 'Target y in device points (`tap`/`text` by point).' },
      startX: { type: 'number', description: 'Swipe start x in device points.' },
      startY: { type: 'number', description: 'Swipe start y in device points.' },
      endX: { type: 'number', description: 'Swipe end x in device points.' },
      endY: { type: 'number', description: 'Swipe end y in device points.' },
      duration: { type: 'number', description: 'Swipe duration in milliseconds.' },
      usage: { type: 'number', description: 'HID usage code of the key to press (`key`).' },
      button: { type: 'string', enum: ['home', 'lock', 'side_button', 'siri', 'apple_pay', 'play_pause'], description: 'Hardware button to press (`button`).' },
      text: { type: 'string', description: 'The value to set on the target element (`text`).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          simulatorId: { type: 'string', required: true },
          inputAction: { type: 'string', enum: ['tap', 'swipe', 'key', 'text', 'button'], required: true },
          actedAt: {
            type: 'object',
            additionalProperties: false,
            properties: {
              xPoints: { type: 'number', required: true },
              yPoints: { type: 'number', required: true },
            },
          },
        },
      },
      render: (_args, value: SimulatorInputValue) => [{
        type: 'text',
        text: value.actedAt === undefined
          ? `<input simulator="${value.simulatorId}" gesture="${value.inputAction}" />`
          : `<input simulator="${value.simulatorId}" gesture="${value.inputAction}" at="${String(value.actedAt.xPoints)},${String(value.actedAt.yPoints)}" />`,
      }],
    },
    isConcurrencySafe: () => false,
    async execute(args: SimInputArgs, exec) {
      const request = {
        ...(typeof args.device === 'string' ? { simulator: requestedDevice(args.device) } : {}),
        action: buildAction(args),
      }
      const result = await simulators.input(request)
      const value: SimulatorInputValue = {
        simulatorId: String(result.simulatorId),
        inputAction: request.action.kind,
        ...(result.actedAt === undefined ? {} : {
          actedAt: { xPoints: result.actedAt.xPoints, yPoints: result.actedAt.yPoints },
        }),
      }
      recordIosSimAction(ctx, exec, {
        action: 'input',
        simulatorId: value.simulatorId,
        inputAction: request.action.kind,
        target: targetDescriptor(args),
      })
      return value
    },
    presentCall(args) {
      return { card: 'generic', title: 'Input gesture', kind: 'other', rawInput: args }
    },
  }))
}
