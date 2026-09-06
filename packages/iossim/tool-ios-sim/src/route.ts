/**
 * Route gate for image-returning tool results: mirrors dsh-tool-fs's
 * `read_image` gate (duplicated deliberately — consumer-to-consumer imports
 * are not a supported edge). An image-producing tool is useful only when the
 * EXACT calling route can inspect its result, so unknown capability refuses
 * before any substrate or attachment work happens.
 * @module @deepseek-ai/dsh-tool-ios-sim/route
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'

/**
 * Require the calling route's resolved model to declare `image` input.
 * @param ctx - plugin context resolving the optional `llm` service.
 * @param exec - the tool-execution context supplying the agent and signal.
 * @param what - short noun phrase naming the refused artifact in messages.
 */
export async function assertImageCapableRoute(ctx: Context, exec: ToolExecution, what: string): Promise<void> {
  const routed = exec.agent?.session.requestHeader()?.config
  const provider = routed?.provider ?? exec.agent?.options.provider
  const model = routed?.model ?? exec.agent?.options.model
  const llm = ctx.get('llm')
  if (provider === undefined || model === undefined || llm === undefined) {
    throw new Error(`cannot take ${what}: the current model route could not be resolved`)
  }
  const active = await llm.resolveModelInfo(provider, model, exec.signal)
  if (active.inputModalities === undefined || !active.inputModalities.includes('image')) {
    throw new Error(
      `cannot take ${what}: model "${model}" does not declare image input; `
        + 'switch to an image-capable model to see screenshots',
    )
  }
}
