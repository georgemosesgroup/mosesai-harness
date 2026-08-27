/**
 * The `sim_describe` tool: the model's window into the device availability
 * tree — the read that mints the element references `sim_input` acts on.
 * @module @deepseek-ai/dsh-tool-ios-sim/describe
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { IosSimulator, SimulatorAccessibilityElement } from '@deepseek-ai/dsh-ios-sim'
import { recordIosSimAction } from './event.ts'
import { requestedDevice } from './request.ts'
import type { SimulatorDescribeElement, SimulatorDescribeValue } from './types.ts'

/** Maximum rendered elements; larger trees truncate with a named note. */
const MAX_ELEMENTS = 60

/** Flatten one tree in walk order, collecting references, roles, and frames. */
function flatten(element: SimulatorAccessibilityElement, into: SimulatorDescribeElement[]): void {
  if (into.length >= MAX_ELEMENTS) return
  const entry: SimulatorDescribeElement = {
    reference: element.reference,
    role: element.role,
    enabled: element.enabled,
  }
  if (element.label !== undefined) entry.label = element.label
  if (element.identifier !== undefined) entry.identifier = element.identifier
  if (element.frame !== undefined) {
    entry.frame = {
      x: element.frame.xPoints,
      y: element.frame.yPoints,
      width: element.frame.widthPoints,
      height: element.frame.heightPoints,
    }
  }
  into.push(entry)
  for (const child of element.children) flatten(child, into)
}

/**
 * Register `sim_describe`.
 * @param ctx - composition context carrying the tools registry.
 * @param simulators - the mounted simulator provider to call through.
 */
export function registerSimDescribeTool(ctx: Context, simulators: IosSimulator): void {
  ctx.tools.register(defineTool({
    name: 'sim_describe',
    description: 'Read the frontmost application\u2019s availability tree on an iOS simulator: element roles, labels, '
      + 'frames in points, and stable `reference` ids. Call this before `sim_input` — an input by element '
      + 'reference is only valid against the references this read issued, and a re-describe repaginates a live UI. '
      + 'Omitting `device` auto-targets the single booted simulator when exactly one exists.',
    parameters: {
      device: { type: 'string', description: 'Simulator id from sim_list; omitted means the single booted simulator.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          simulatorId: { type: 'string', required: true },
          truncated: { type: 'boolean', required: true },
          screen: {
            type: 'object',
            additionalProperties: false,
            properties: {
              widthPoints: { type: 'number', required: true },
              heightPoints: { type: 'number', required: true },
            },
          },
          elements: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                reference: { type: 'string', required: true },
                role: { type: 'string', required: true },
                label: { type: 'string' },
                identifier: { type: 'string' },
                frame: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    x: { type: 'number', required: true },
                    y: { type: 'number', required: true },
                    width: { type: 'number', required: true },
                    height: { type: 'number', required: true },
                  },
                },
                enabled: { type: 'boolean', required: true },
              },
            },
          },
        },
      },
      render: (_args, value: SimulatorDescribeValue) => [{
        type: 'text',
        text: `<availability simulator="${value.simulatorId}"${value.screen === undefined ? '' : ` screen="${String(value.screen.widthPoints)}x${String(value.screen.heightPoints)}"`}>\n`
          + value.elements.map((e) => {
            const frame = e.frame === undefined ? 'unframed' : `@${String(e.frame.x)},${String(e.frame.y)} ${String(e.frame.width)}x${String(e.frame.height)}`
            const label = e.label === undefined ? '' : ` label="${e.label}"`
            const identifier = e.identifier === undefined ? '' : ` id="${e.identifier}"`
            return `- [${e.reference}] ${e.role}${label}${identifier} ${frame}${e.enabled ? '' : ' [disabled]'}`
          }).join('\n')
          + `\n</availability>${value.elements.length >= MAX_ELEMENTS ? ' (tree truncated at ' + String(MAX_ELEMENTS) + ' elements)' : ''}`,
      }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const result = await simulators.describe({ simulator: requestedDevice(args.device) })
      const elements: SimulatorDescribeElement[] = []
      if (result.root !== null) flatten(result.root, elements)
      const value: SimulatorDescribeValue = {
        simulatorId: String(result.simulatorId),
        truncated: result.truncated,
        ...(result.screen === undefined ? {} : {
          screen: { widthPoints: result.screen.widthPoints, heightPoints: result.screen.heightPoints },
        }),
        elements,
      }
      recordIosSimAction(ctx, exec, { action: 'describe', simulatorId: value.simulatorId, elements: elements.length })
      return value
    },
    presentCall(args) {
      return { card: 'generic', title: 'Describe availability tree', kind: 'other', rawInput: args }
    },
  }))
}
