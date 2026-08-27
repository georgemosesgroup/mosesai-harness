import type { Context } from '@deepseek-ai/cordis'
import {
  CallId,
  LlmAdapter,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'

const LIST_CALL = CallId('ios-sim-native-list-call')
const SHOT_CALL = CallId('ios-sim-native-shot-call')

function sawMarker(options: GenerateOptions, marker: string): boolean {
  return options.messages.some(message => message.content.some(
    block => block.type === 'tool-result'
      && block.content.some(part => part.type === 'text' && part.text.includes(marker)),
  ))
}

/**
 * Keyless native-provider snapshot adapter: one scripted turn that calls
 * `sim_list` and `sim_screenshot` against a provider that declares only
 * `describe`, so both tools answer with the capability gate's named refusal,
 * and the final answer quotes that deterministic code. Proves the
 * unadvertised-verb rejection through the assembled composition; the
 * `describe` happy path is exercised by the driver's direct service probe.
 */
class IosSimNativeMockAdapter extends LlmAdapter {
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return {
      provider,
      id: model,
      name: model,
      // Image input declared so `sim_screenshot` passes its model-capability
      // gate and reaches the capability gate whose refusal this snapshot pins.
      inputModalities: ['text', 'image'],
    }
  }

  override listModels(provider: string): Promise<readonly LlmResolvedModelInfo[]> {
    return this.resolveModel(provider, 'ios-sim-native-mock').then(model => [model])
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (!sawMarker(options, 'does not declare the "list" capability')) {
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id: LIST_CALL, name: 'sim_list', argumentsDelta: '{}' }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: LIST_CALL, name: 'sim_list', arguments: '{}' } }
      yield { type: 'usage', usage: { inputTokens: 9, outputTokens: 2 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    if (!sawMarker(options, 'does not declare the "screenshot" capability')) {
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id: SHOT_CALL, name: 'sim_screenshot', argumentsDelta: '{}' }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: SHOT_CALL, name: 'sim_screenshot', arguments: '{}' } }
      yield { type: 'usage', usage: { inputTokens: 12, outputTokens: 2 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    const reply = 'IOSIM_NATIVE_SNAPSHOT_OK: the native provider answered both unadvertised tools with the capability gate.'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: reply }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: reply } }
    yield { type: 'usage', usage: { inputTokens: 17, outputTokens: 6 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export const name = 'ios-sim-native-mock-llm'
export const inject = ['llm']

/** Register the keyless `ios-sim-native-mock` adapter. */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['ios-sim-native-mock'], new IosSimNativeMockAdapter())
}
