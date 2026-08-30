import type { Context } from '@deepseek-ai/cordis'
import {
  ToolCallId,
  LlmAdapter,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'

const LIST_CALL = ToolCallId('ios-sim-list-call')
const SHOT_CALL = ToolCallId('ios-sim-shot-call')

function sawMarker(options: GenerateOptions, marker: string): boolean {
  return options.messages.some(message => message.content.some(
    block => block.type === 'tool-result'
      && block.content.some(part => part.type === 'text' && part.text.includes(marker)),
  ))
}

/**
 * Keyless ios-sim snapshot adapter: one scripted turn calling `sim_list` and
 * `sim_screenshot` together, then a final answer quoting the deterministic
 * facts the stub substrate produced. The route declares image input so the
 * screenshot tool's image-capability gate passes keylessly.
 */
class IosSimMockAdapter extends LlmAdapter {
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return {
      provider,
      id: model,
      name: model,
      inputModalities: ['text', 'image'],
    }
  }

  override listModels(provider: string): Promise<readonly LlmResolvedModelInfo[]> {
    return this.resolveModel(provider, 'ios-sim-mock').then(model => [model])
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const sawList = sawMarker(options, '<devices count=')
    const sawShot = sawMarker(options, '<type>screenshot</type>')
    if (!sawList) {
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id: LIST_CALL, name: 'sim_list', argumentsDelta: '{}' }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: LIST_CALL, name: 'sim_list', arguments: '{}' } }
      yield { type: 'usage', usage: { inputTokens: 9, outputTokens: 2 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    if (!sawShot) {
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id: SHOT_CALL, name: 'sim_screenshot', argumentsDelta: '{}' }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: SHOT_CALL, name: 'sim_screenshot', arguments: '{}' } }
      yield { type: 'usage', usage: { inputTokens: 12, outputTokens: 2 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    const reply = 'IOS_SIM_SNAPSHOT_OK: listed devices and captured the booted simulator screen.'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: reply }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: reply } }
    yield { type: 'usage', usage: { inputTokens: 17, outputTokens: 6 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export const name = 'ios-sim-mock-llm'
export const inject = ['llm']

/** Register the keyless `ios-sim-mock` adapter. */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['ios-sim-mock'], new IosSimMockAdapter())
}
