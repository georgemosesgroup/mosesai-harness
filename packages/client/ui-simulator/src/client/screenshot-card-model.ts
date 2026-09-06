/**
 * Pure view model for the `sim_screenshot` toolview: derived only from the
 * frozen running-or-settled call block, so a live call and a replayed log
 * render the identical row.
 */

import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'

/** The call block a toolview receives: a running call or a settled result node. */
export type ScreenshotBlock = ToolCallViewProps['block']

/** Row lifecycle derived solely from the durable call slice. */
export type ScreenshotRowState = 'running' | 'ok' | 'error' | 'stopped'

/** The settled screenshot the row draws: durable references plus the envelope. */
export interface ScreenshotCard {
  /** Durable image references in result order. */
  readonly images: readonly ImageAttachmentRef[]
  /** The text blocks beside the images, joined by newlines. */
  readonly text: string
}

/** Everything the row renders. */
export interface ScreenshotRowModel {
  /** The device the call targeted: persisted meta first, then the argument, else `auto`. */
  readonly device: string
  readonly state: ScreenshotRowState
  /** First error line for the collapsed summary of a failed row; null otherwise. */
  readonly errorSummary: string | null
  /** Flattened result text for the fallback output when no card derives; null when empty. */
  readonly output: string | null
  /** The image card, or null while running, on error, or when the content is not an image result. */
  readonly card: ScreenshotCard | null
}

/** The device argument `sim_screenshot` accepts; absent means the single booted simulator. */
const AUTO_DEVICE = 'auto'

function firstLine(text: string): string {
  const newline = text.indexOf('\n')
  return newline === -1 ? text : text.slice(0, newline)
}

/**
 * Whether a wire value is a usable pixel or byte measure.
 * @param value - unvalidated wire value.
 * @returns true when it is a positive integer.
 */
function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

/** The `device` argument of the call, when the JSON parses and names one. */
function deviceArgument(argsRaw: string): string | undefined {
  try {
    const parsed = JSON.parse(argsRaw) as unknown
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const { device } = parsed as Record<string, unknown>
    return typeof device === 'string' && device !== '' ? device : undefined
  } catch {
    // A running call streams a JSON prefix; the label then waits for the settled meta.
    return undefined
  }
}

/** The persisted `presentationMeta.device`, which names the simulator that actually answered. */
function deviceMeta(meta: unknown): string | undefined {
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return undefined
  const { device } = meta as Record<string, unknown>
  return typeof device === 'string' && device !== '' ? device : undefined
}

/**
 * Narrow one image block's attachment reference. Every field arrives
 * unvalidated on replay, so a mismatch declines the whole card rather than
 * rendering a partial gallery. The attachment id is checked for presence only:
 * it is opaque and provider-owned.
 */
function imageReference(attachment: unknown): ImageAttachmentRef | null {
  if (typeof attachment !== 'object' || attachment === null || Array.isArray(attachment)) return null
  const { attachmentId, mediaType, bytes, width, height, name } = attachment as Record<string, unknown>
  if (typeof attachmentId !== 'string' || attachmentId === '') return null
  if (typeof mediaType !== 'string' || mediaType === '') return null
  if (!positiveInteger(bytes) || !positiveInteger(width) || !positiveInteger(height)) return null
  const ref = {
    attachmentId, mediaType, bytes, width, height,
  } as unknown as ImageAttachmentRef
  return typeof name === 'string' && name !== '' ? { ...ref, name } : ref
}

/**
 * Narrow the settled content into the card: every block must be a text or an
 * image block, and at least one image must be present. Any other block type
 * declines, so a post-execute hook's appended content is never silently hidden.
 */
function screenshotCard(content: readonly unknown[]): ScreenshotCard | null {
  const images: ImageAttachmentRef[] = []
  const texts: string[] = []
  for (const part of content) {
    if (typeof part !== 'object' || part === null) return null
    const { type, text, attachment } = part as Record<string, unknown>
    if (type === 'text' && typeof text === 'string') {
      texts.push(text)
      continue
    }
    if (type !== 'image') return null
    const ref = imageReference(attachment)
    if (ref === null) return null
    images.push(ref)
  }
  if (images.length === 0) return null
  return { images, text: texts.join('\n') }
}

/**
 * Flatten durable result blocks under the generic Tool-row text contract, for
 * the rows that carry no card (an error, or content the card declines).
 */
function resultText(block: ScreenshotBlock): string | null {
  if (!('kind' in block)) return null
  const parts: string[] = []
  for (const item of block.content) {
    parts.push(item.type === 'text' ? item.text : JSON.stringify(item, null, 2))
  }
  if (parts.length === 0 && block.error !== undefined) {
    parts.push(`${block.error.name}: ${block.error.code}`)
  }
  return parts.join('\n') || null
}

/**
 * Derive the row from the frozen call block.
 * @param block - running call or settled result node of a `sim_screenshot` call.
 * @returns the row model; the card is null for every non-image outcome.
 */
export function screenshotRowModel(block: ScreenshotBlock): ScreenshotRowModel {
  const settled = 'kind' in block
  const argsRaw = (settled ? block.call?.argsRaw : block.argsRaw) ?? ''
  const state: ScreenshotRowState = !settled
    ? 'running'
    : block.error?.code === 'interrupted'
      ? 'stopped'
      : block.isError ? 'error' : 'ok'
  const output = resultText(block)
  const card = settled && state === 'ok' ? screenshotCard(block.content) : null
  return {
    device: (settled ? deviceMeta(block.meta) : undefined) ?? deviceArgument(argsRaw) ?? AUTO_DEVICE,
    state,
    errorSummary: state === 'error' && output !== null ? firstLine(output) : null,
    output,
    card,
  }
}
