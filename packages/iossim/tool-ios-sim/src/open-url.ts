/**
 * The `sim_open_url` tool: hand one URL to the target simulator's URL handler
 * (Safari for https pages, any custom scheme installed apps registered).
 * @module @deepseek-ai/dsh-tool-ios-sim/open-url
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { IosSimulator } from '@deepseek-ai/dsh-ios-sim'
import { recordIosSimAction } from './event.ts'
import { requestedDevice } from './request.ts'
import type { SimulatorOpenUrlValue } from './types.ts'

/**
 * Register `sim_open_url`.
 * @param ctx - composition context carrying the tools registry.
 * @param simulators - the mounted simulator provider to call through.
 */
export function registerSimOpenUrlTool(ctx: Context, simulators: IosSimulator): void {
  ctx.tools.register(defineTool({
    name: 'sim_open_url',
    description: 'Open one URL on an iOS simulator — https pages in Safari or any custom scheme the '
      + 'installed apps registered. Auto-targets the single booted simulator unless `device` names one.',
    parameters: {
      url: { type: 'string', required: true, description: 'Absolute URL for the device\'s URL handler.' },
      device: { type: 'string', description: 'Simulator id from sim_list; omitted means the single booted simulator.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          device: {
            type: 'object',
            additionalProperties: false,
            required: true,
            properties: {
              id: { type: 'string', required: true },
            },
          },
          url: { type: 'string', required: true },
        },
      },
      render: (_args, value: SimulatorOpenUrlValue) => [{
        type: 'text',
        text: `<opened>${value.url} on ${value.device.id}</opened>`,
      }],
    },
    async execute(args, exec) {
      const url = args.url.trim()
      if (!/^[a-z][a-z0-9+.-]*:/iu.test(url)) {
        throw new Error('url must be absolute (it needs a scheme like https:)')
      }
      const resolved = await simulators.openUrl({ simulator: requestedDevice(args.device), url })
      const value: SimulatorOpenUrlValue = { device: { id: String(resolved.simulatorId) }, url }
      recordIosSimAction(ctx, exec, { action: 'openurl', simulatorId: value.device.id, url })
      return value
    },
    presentCall(args) {
      return { card: 'generic', title: `Open ${args.url}`, kind: 'other', rawInput: args }
    },
  }))
}
