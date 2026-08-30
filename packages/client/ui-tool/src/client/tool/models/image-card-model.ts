/**
 * Pure derivation of the image-card facts from a frozen call slice: the
 * `card:'image'` render intent an image-payload tool declares at result time
 * (`sim_screenshot` today) arrives on the snapshot as `resultView`, and this
 * model carries it to the details panel verbatim.
 *
 * Result-only by contract: image tools keep a generic pending call view, so
 * while the call runs nothing image-shaped exists. A `card` value this UI
 * version does not know arrives over the wire from a newer host and cannot be
 * trusted to be one of the compiled variants, so it returns null and takes the
 * generic path (the documented fallback).
 * @module
 */
import type { ToolCallBlock } from './tool-call-model.ts'

/** What the details panel draws for one settled image card. */
export interface ImageCardModel {
  /** One-line origin naming what was captured, when the tool supplied one. */
  origin?: string
  /** Durable content-addressed attachment id behind the raster. */
  attachmentId: string
  /** Declared media type of the referenced bytes. */
  mediaType: string
  /** Encoded size in bytes. */
  bytes: number
  /** Pixel width of the referenced raster. */
  width: number
  /** Pixel height of the referenced raster. */
  height: number
}

/**
 * Derive the image-card facts for a tool call, or null when this call belongs
 * on the generic path.
 *
 * Null cases, all documented defaults: a running call (no `resultView` yet), a
 * settled call whose result view is not an image card (including future `card`
 * values over the wire), or an image card missing its required scalar facts
 * (a malformed producer must never draw a broken figure).
 *
 * @param block - RunningToolCall or ToolResultNode off the snapshot caches.
 * @returns the image-card facts, or null for the generic path.
 */
export function imageCardModel(block: ToolCallBlock): ImageCardModel | null {
  // A settled result's presentation card rides block.meta now, in the same
  // shape the other cards read (web/read/diff), not a resultView field.
  if (!('kind' in block) || block.isError) return null
  if (typeof block.meta !== 'object' || block.meta === null || Array.isArray(block.meta)) return null
  const meta = block.meta as Record<string, unknown>
  if (meta.card !== 'image') return null
  if (typeof meta.attachmentId !== 'string' || meta.attachmentId.length === 0) return null
  if (typeof meta.mediaType !== 'string' || meta.mediaType.length === 0) return null
  const bytes = meta.bytes, width = meta.width, height = meta.height
  for (const value of [bytes, width, height]) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) return null
  }
  const origin = typeof meta.origin === 'string' && meta.origin.length > 0 ? meta.origin : undefined
  return {
    ...(origin === undefined ? {} : { origin }),
    attachmentId: meta.attachmentId,
    mediaType: meta.mediaType,
    bytes: bytes as number,
    width: width as number,
    height: height as number,
  }
}
