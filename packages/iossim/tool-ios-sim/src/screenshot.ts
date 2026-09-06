/**
 * The `sim_screenshot` tool: capture the target simulator's screen, commit the
 * PNG through the durable attachment seam FIRST, and return one image block
 * beside a small envelope. The completed card is the dedicated
 * `card: 'image'` render intent — the raster IS the payload, so generic text
 * rows and terminal cards cannot present it; a UI without that capability
 * falls back to the raw content blocks.
 * @module @deepseek-ai/dsh-tool-ios-sim/screenshot
 */

import type { Context } from '@deepseek-ai/cordis'
import { AttachmentError } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolResultView } from '@deepseek-ai/dsh-tools'
import type { IosSimulator } from '@deepseek-ai/dsh-ios-sim'
import { recordIosSimAction } from './event.ts'
import { requestedDevice } from './request.ts'
import { assertImageCapableRoute } from './route.ts'
import type { SimulatorImageFacts, SimulatorScreenshotValue } from './types.ts'

/**
 * Re-brand serialized facts into the durable reference an `ImageBlock`
 * carries.
 * @param facts - the log-safe projection persisted with the action event.
 * @returns the branded attachment reference for content-block rendering.
 */
export function imageRefFromFacts(facts: SimulatorImageFacts): ImageAttachmentRef {
  return {
    attachmentId: facts.attachmentId as ImageAttachmentRef['attachmentId'],
    mediaType: facts.mediaType as ImageAttachmentRef['mediaType'],
    bytes: facts.bytes,
    width: facts.width,
    height: facts.height,
  }
}

/**
 * Narrow persisted presentation meta back into the dedicated image card —
 * pure over the logged metadata so live calls and replay produce the identical
 * view; malformed or older logged metas fall back to `undefined` (the generic
 * row) instead of throwing ([defineTool soft-validation](../../../../docs/cookbook/adding-a-tool.md)).
 * @param meta - the value stored on the tool/result event.
 * @returns the image card, or undefined when meta does not carry valid facts.
 */
export function imageViewFromMeta(meta: unknown): ImageResultViewNarrowed | undefined {
  if (typeof meta !== 'object' || meta === null) return undefined
  const m = meta as Record<string, unknown>
  const device = ((): string | undefined => typeof m.device === 'string' && m.device.length > 0 ? m.device : undefined)()
  const image = m.image
  if (typeof image !== 'object' || image === null) return undefined
  const f = image as Record<string, unknown>
  if (typeof f.attachmentId !== 'string' || f.attachmentId.length === 0) return undefined
  if (typeof f.mediaType !== 'string' || f.mediaType.length === 0) return undefined
  const bytes = f.bytes
  if (typeof bytes !== 'number' || !Number.isInteger(bytes) || bytes <= 0) return undefined
  const width = f.width
  if (typeof width !== 'number' || !Number.isInteger(width) || width <= 0) return undefined
  const height = f.height
  if (typeof height !== 'number' || !Number.isInteger(height) || height <= 0) return undefined
  return {
    card: 'image',
    ...(device === undefined ? {} : { origin: device }),
    attachmentId: f.attachmentId,
    mediaType: f.mediaType,
    bytes,
    width,
    height,
  }
}

type ImageResultViewNarrowed = Extract<ToolResultView, { card: 'image' }>

/** Small envelope beside the image block naming the device and the scale reality. */
function envelopeText(value: SimulatorScreenshotValue): string {
  const device = value.device.id
  return `<device>${device}</device>
<type>screenshot</type>
<content>
${value.image.mediaType} image, ${value.image.width}x${value.image.height} px. Pixels are the native raster; logical points are not reported by the public simctl surface.
</content>`
}

/**
 * Register `sim_screenshot`.
 * @param ctx - composition context carrying the tools registry, attachments
 *   service, and llm route facts.
 * @param simulators - the mounted simulator provider to call through.
 */
export function registerSimScreenshotTool(ctx: Context, simulators: IosSimulator): void {
  ctx.tools.register(defineTool({
    name: 'sim_screenshot',
    description: 'Take a PNG screenshot of an iOS simulator screen and return the image itself. '
      + 'Auto-targets the single booted simulator unless `device` names one. Requires the current '
      + 'model to accept image input. Coordinate taps are unavailable by design until element '
      + 'references arrive; use screenshots to inspect state, not to aim inputs.',
    parameters: {
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
            properties: {
              id: { type: 'string', required: true },
            },
          },
          image: {
            type: 'object',
            additionalProperties: false,
            properties: {
              attachmentId: { type: 'string', required: true },
              mediaType: { type: 'string', required: true },
              bytes: { type: 'integer', required: true },
              width: { type: 'integer', required: true },
              height: { type: 'integer', required: true },
            },
          },
        },
      },
      // The model sees one small envelope plus the committed image block.
      render: (_args, value: SimulatorScreenshotValue): ContentBlock[] => [
        { type: 'text', text: envelopeText(value) },
        { type: 'image', attachment: imageRefFromFacts(value.image) },
      ],
      // Persisted with tool/result so REPLAY rebuilds the exact card. Built as
      // a fresh literal of primitives: JsonValue demands index-signature data.
      presentationMeta: (_args, value: SimulatorScreenshotValue) => ({
        device: value.device.id,
        image: {
          attachmentId: value.image.attachmentId,
          mediaType: value.image.mediaType,
          bytes: value.image.bytes,
          width: value.image.width,
          height: value.image.height,
        },
      }),
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const attachments = ctx.get('attachments')
      if (attachments === undefined) {
        throw new Error('cannot take a simulator screenshot: no attachment service is mounted')
      }
      if (!attachments.imageLimits.mediaTypes.includes('image/png')) {
        throw new Error('cannot take a simulator screenshot: this deployment does not accept PNG attachments')
      }
      await assertImageCapableRoute(ctx, exec, 'a simulator screenshot')

      const result = await simulators.screenshot({ simulator: requestedDevice(args.device) })

      // Byte bounds mirror dsh-tool-fs read_image: the message aggregate bound
      // applies beside the per-image bound, checked BEFORE any durable write —
      // an oversized raster must never enter durable history.
      const byteCap = Math.min(attachments.imageLimits.maxImageBytes, attachments.imageLimits.maxMessageImageBytes)
      if (result.data.byteLength > byteCap) {
        throw new Error(
          'the simulator screenshot exceeds this deployment\'s attachment byte limit even before storage; '
            + 'reduce the device resolution or raise the attachment limits',
        )
      }
      let ref: ImageAttachmentRef
      try {
        ref = await attachments.saveImage({
          data: result.data,
          mediaType: result.mediaType,
          name: `simulator-${String(result.simulatorId)}.png`,
        })
      } catch (error: unknown) {
        if (!(error instanceof AttachmentError)) throw error
        if (error.code === 'IMAGE_DIMENSION_TOO_LARGE' || error.code === 'IMAGE_TOO_MANY_PIXELS') {
          throw new Error(
            'the simulator screenshot exceeds the deployment\'s pixel-dimension limits; reduce the device '
              + 'resolution or raise the attachment limits',
            { cause: error },
          )
        }
        throw error
      }

      const facts: SimulatorImageFacts = {
        attachmentId: String(ref.attachmentId),
        mediaType: ref.mediaType,
        bytes: ref.bytes,
        width: ref.width,
        height: ref.height,
      }
      // Order matters: durable commit happened above; now log the action event,
      // then hand back the value whose render references the committed object.
      recordIosSimAction(ctx, exec, {
        action: 'screenshot',
        simulatorId: String(result.simulatorId),
        image: facts,
      })
      return { device: { id: String(result.simulatorId) }, image: facts }
    },
    presentCall(args) {
      return { card: 'generic', title: 'Screenshot simulator', kind: 'other', rawInput: args }
    },
    presentResult(_args, result) {
      // Pure narrow over the persisted meta; undefined falls back to the generic row.
      return imageViewFromMeta(result.meta)
    },
  }))
}
