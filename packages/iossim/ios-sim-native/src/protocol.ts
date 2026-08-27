/**
 * The helper's framed wire protocol, shared verbatim with the Swift side
 * (native/iossim-helper/README.md owns the contract): a one-byte frame type,
 * a 4-byte big-endian length, then that many bytes of payload. Type 0 frames
 * carry UTF-8 JSON (protocol control); type 1 frames carry raw encoded video
 * chunks. A byte bound poisons the stream when exceeded, and clean EOF ends
 * the iterator.
 * @module @deepseek-ai/dsh-ios-sim-native/protocol
 */

import type { Readable } from 'node:stream'

/** Upper bound of one frame's payload in bytes; must match the helper's bound. */
export const MAX_FRAME_BYTES = 64 << 20

/** Frame type 0: the payload is UTF-8 JSON (hello, requests, responses). */
export const FRAME_JSON = 0

/** Frame type 1: the payload is raw encoded video bytes (a live stream chunk). */
export const FRAME_VIDEO = 1

/** One demultiplexed frame: its type and the raw payload bytes. */
export interface RawFrame {
  type: number
  payload: Buffer
}

/**
 * Encode one JSON protocol frame (a type-0 frame).
 * @param body - the JSON object to send; must be serializable (provider
 *   frames are built from typed values).
 * @returns the exact bytes to write to the helper's stdin.
 */
export function encodeFrame(body: object): Buffer {
  const payload = Buffer.from(JSON.stringify(body), 'utf8')
  return encodeTyped(FRAME_JSON, payload)
}

/**
 * Encode one typed frame from raw payload bytes.
 * @param type - the frame type byte.
 * @param payload - the raw payload (JSON bytes for type 0, video bytes for type 1).
 * @returns the exact bytes to write.
 */
export function encodeTyped(type: number, payload: Buffer): Buffer {
  const frame = Buffer.alloc(5 + payload.length)
  frame.writeUInt32BE(payload.length + 1, 0)
  frame.writeUInt8(type, 4)
  payload.copy(frame, 5)
  return frame
}

/**
 * Read demultiplexed frames from the helper's stdout stream until clean EOF.
 * Framing errors (an oversized length, trailing bytes) throw; a clean stream
 * end resolves the iterator.
 * @param stream - the child's stdout, spawned in pipe mode.
 * @returns raw frames in stream order.
 */
export async function* rawFrames(stream: Readable): AsyncGenerator<RawFrame> {
  let buffer = Buffer.alloc(0)
  for await (const chunk of stream) {
    buffer = Buffer.concat([buffer, chunk as Buffer])
    while (buffer.length >= 4) {
      const length = buffer.readUInt32BE(0)
      if (length < 1 || length > MAX_FRAME_BYTES) {
        throw new RangeError(`helper frame length ${length} is outside the 1...${MAX_FRAME_BYTES} byte bound`)
      }
      if (buffer.length < 4 + length) break
      const payload = buffer.subarray(4 + 1, 4 + length)
      yield { type: buffer.readUInt8(4), payload }
      buffer = buffer.subarray(4 + length)
    }
  }
  if (buffer.length !== 0) {
    throw new RangeError(`helper stream ended with ${buffer.length} trailing bytes inside an unfinished frame`)
  }
}
