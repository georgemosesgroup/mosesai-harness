/**
 * The `sim_launch` tool: start one installed application on a simulator and
 * report what the substrate observed. The result carries the resolved device
 * echo, the host pid when printed, and the documented point-geometry note a
 * level-0 provider answers with instead of invented sizes.
 * @module @deepseek-ai/dsh-tool-ios-sim/launch
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { IosSimulator } from '@deepseek-ai/dsh-ios-sim'
import { recordIosSimAction } from './event.ts'
import { requestedDevice } from './request.ts'
import type { SimulatorLaunchValue } from './types.ts'

/**
 * Register `sim_launch`.
 * @param ctx - composition context carrying the tools registry.
 * @param simulators - the mounted simulator provider to call through.
 */
export function registerSimLaunchTool(ctx: Context, simulators: IosSimulator): void {
  ctx.tools.register(defineTool({
    name: 'sim_launch',
    description: 'Launch one INSTALLED application on an iOS simulator by bundle identifier '
      + '(for example com.apple.Preferences for Settings). Auto-targets the single booted simulator '
      + 'unless `device` names one. Installs nothing: deploy apps through other means first. '
      + 'The result echoes the resolved device and reports geometry in points when the provider can attest it.',
    parameters: {
      bundle_id: {
        type: 'string',
        required: true,
        description: 'Bundle identifier of an app already installed on the target simulator.',
      },
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
              name: { type: 'string' },
            },
          },
          bundleId: { type: 'string', required: true },
          pid: { type: 'integer' },
          geometryNote: { type: 'string' },
        },
      },
      render: (_args, value: SimulatorLaunchValue) => [{
        type: 'text',
        text: `<launched>${value.bundleId} on `
          + (value.device.name === undefined ? value.device.id : `${value.device.name} (${value.device.id})`)
          + (value.pid === undefined ? '' : `, pid ${String(value.pid)}`)
          + '</launched>',
      }],
    },
    async execute(args, exec) {
      const result = await simulators.launch({
        simulator: requestedDevice(args.device),
        bundleId: args.bundle_id,
      })
      const value: SimulatorLaunchValue = {
        device: { id: String(result.simulatorId) },
        bundleId: result.bundleId,
      }
      if (result.pid !== undefined) value.pid = result.pid
      if (result.geometryNote !== undefined) value.geometryNote = result.geometryNote
      recordIosSimAction(ctx, exec, {
        action: 'launch',
        simulatorId: value.device.id,
        bundleId: value.bundleId,
        ...value.pid === undefined ? {} : { pid: value.pid },
      })
      return value
    },
    presentCall(args) {
      return { card: 'generic', title: `Launch ${args.bundle_id}`, kind: 'execute', rawInput: args }
    },
  }))
}
