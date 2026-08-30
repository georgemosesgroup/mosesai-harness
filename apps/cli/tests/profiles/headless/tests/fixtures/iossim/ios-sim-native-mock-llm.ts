import type { Context } from '@deepseek-ai/cordis'
import {
  ToolCallId,
  LlmAdapter,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'

const LIST_CALL = ToolCallId('ios-sim-native-list-call')
const SHOT_CALL = ToolCallId('ios-sim-native-shot-call')
const DESCRIBE_CALL = ToolCallId('ios-sim-native-describe-call')
const INPUT_CALL = ToolCallId('ios-sim-native-input-call')

function sawMarker(options: GenerateOptions, marker: string): boolean {
  return options.messages.some(message => message.content.some(
    block => block.type === 'tool-result'
      && block.content.some(part => part.type === 'text' && part.text.includes(marker)),
  ))
}

/**
 * Keyless native-provider snapshot adapter: one scripted turn proving the
 * capability gate (sim_list and sim_screenshot refuse loudly on a provider
 * that does not advertise them), then the served verbs — sim_describe mints
 * element references and sim_input taps one of them. The final answer quotes
 * the deterministic markers the stub produced. The route declares image input
 * so the screenshot tool's image-capability gate passes keylessly.
 */
class IosSimNativeMockAdapter extends LlmAdapter {
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return {
      provider,
      id: model,
      name: model,
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
    if (!sawMarker(options, '<availability')) {
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id: DESCRIBE_CALL, name: 'sim_describe', argumentsDelta: '{}' }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: DESCRIBE_CALL, name: 'sim_describe', arguments: '{}' } }
      yield { type: 'usage', usage: { inputTokens: 15, outputTokens: 2 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    if (!sawMarker(options, '<input simulator="STUB-A"')) {
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield {
        type: 'tool-call-delta',
        index: 0,
        id: INPUT_CALL,
        name: 'sim_input',
        argumentsDelta: '{"action":"tap","reference":"0.0"}',
      }
      yield {
        type: 'block-end',
        index: 0,
        block: { type: 'tool-call', id: INPUT_CALL, name: 'sim_input', arguments: '{"action":"tap","reference":"0.0"}' },
      }
      yield { type: 'usage', usage: { inputTokens: 18, outputTokens: 2 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    const reply = 'IOSIM_NATIVE_SNAPSHOT_OK: the gate refused the unadvertised tools, describe minted references, and input tapped one.'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: reply }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: reply } }
    yield { type: 'usage', usage: { inputTokens: 21, outputTokens: 6 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export const name = 'ios-sim-native-mock-llm'
export const inject = ['llm']

/** Register the keyless `ios-sim-native-mock` adapter. */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['ios-sim-native-mock'], new IosSimNativeMockAdapter())
}
