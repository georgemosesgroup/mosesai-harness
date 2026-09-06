/**
 * The `sim_list` tool: the model's discovery surface for which simulators it
 * can act on and which one is already booted.
 * @module @deepseek-ai/dsh-tool-ios-sim/list
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { IosSimulator } from '@deepseek-ai/dsh-ios-sim'
import { recordIosSimAction } from './event.ts'
import type { SimulatorListValue } from './types.ts'

/**
 * Register `sim_list`.
 * @param ctx - composition context carrying the tools registry.
 * @param simulators - the mounted simulator provider to call through.
 */
export function registerSimListTool(ctx: Context, simulators: IosSimulator): void {
  ctx.tools.register(defineTool({
    name: 'sim_list',
    description: 'List the iOS simulators this host can control (id, display name, boot state, runtime). '
      + 'Use an id verbatim as the optional `device` argument of the other sim_* tools; omitting `device` '
      + 'auto-targets the single booted simulator when exactly one exists.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          devices: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                name: { type: 'string', required: true },
                state: { type: 'string', enum: ['booted', 'shutdown'], required: true },
                runtime: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value: SimulatorListValue) => [{
        type: 'text',
        text: value.devices.length === 0
          ? '<devices none>'
          : `<devices count="${String(value.devices.length)}">\n`
            + value.devices.map(d => `- ${d.name} [${d.state}] ${d.id} · ${d.runtime}`).join('\n')
            + '\n</devices>',
      }],
    },
    isConcurrencySafe: () => true,
    async execute(_args, exec) {
      const devices = await simulators.list()
      // Canonical value stays JSON-shaped; brand/lifecycle types live on the seam only.
      const value: SimulatorListValue = {
        devices: devices.map(d => ({
          id: String(d.id),
          name: d.name,
          state: d.state,
          runtime: d.runtimeIdentifier,
        })),
      }
      recordIosSimAction(ctx, exec, { action: 'list', devices: value.devices.length })
      return value
    },
    presentCall(args) {
      return { card: 'generic', title: 'List simulators', kind: 'other', rawInput: args }
    },
  }))
}
