/**
 * Model-facing iOS-simulator tools over the `ctx.iosSimulator` capability
 * seam. The registered tools — `sim_list`, `sim_launch`, `sim_open_url`,
 * `sim_screenshot`, `sim_describe`, `sim_input` — and every successful call appends one
 * `iosSim/action` record to the calling agent's session log, so replay shows
 * who drove which device even when tool-result text alone would not tell.
 *
 * No input verbs and no panel: `describe` and `input` need the native
 * provider — the public `simctl` substrate has no touch injection and no
 * availability-tree read, so no provider over it can implement them;
 * coordinate tapping on screenshots is deliberately out of reach.
 *
 * @module @deepseek-ai/dsh-tool-ios-sim
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only: resolves ctx.attachments for the screenshot tool.
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-session'
import { registerSimListTool } from './list.ts'
import { registerSimLaunchTool } from './launch.ts'
import { registerSimOpenUrlTool } from './open-url.ts'
import { registerSimScreenshotTool } from './screenshot.ts'
import { registerSimDescribeTool } from './describe.ts'
import { registerSimInputTool } from './input.ts'

export const name = 'tool-ios-sim'
export const inject = ['tools', 'iosSimulator']

export { recordIosSimAction, validateActionEvent, IOS_SIM_ACTIONS } from './event.ts'
export { imageRefFromFacts, imageViewFromMeta } from './screenshot.ts'
export type {
  IosSimActionEventData,
  SimulatorImageFacts,
  SimulatorLaunchValue,
  SimulatorListValue,
  SimulatorOpenUrlValue,
  SimulatorScreenshotValue,
} from './types.ts'

export function apply(ctx: Context): void {
  // inject guarantees the provider: a composition mounting these tools without
  // ctx.iosSimulator fails loud at load instead of half-working at runtime.
  const simulators = ctx.iosSimulator
  registerSimListTool(ctx, simulators)
  registerSimLaunchTool(ctx, simulators)
  registerSimOpenUrlTool(ctx, simulators)
  registerSimScreenshotTool(ctx, simulators)
  registerSimDescribeTool(ctx, simulators)
  registerSimInputTool(ctx, simulators)
}
