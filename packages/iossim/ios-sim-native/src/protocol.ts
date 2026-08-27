/**
 * The helper's framed wire protocol, shared verbatim with the Swift side
 * (native/iossim-helper/README.md owns the contract): 4-byte big-endian
 * length prefixes over UTF-8 JSON, a byte bound that poisons the stream when
 * exceeded, and clean-EOF-as-completion semantics.
 * @module @deepseek-ai/dsh-ios-sim-native/protocol
 */

import type { Readable } from 'node:stream'

/** Upper bound of one frame's JSON body; must match the helper's bound. */
export const MAX_FRAME_BYTES = 64 << 20

/**
 * Encode one protocol frame.
 * @param body - the JSON object to send; must be serializable (provider
 *   frames are built from typed values).
 * @returns the exact bytes to write to the helper's stdin.
 */
export function encodeFrame(body: object): Buffer {
  const payload = Buffer.from(JSON.stringify(body), 'utf8')
  const frame = Buffer.alloc(4 + payload.length)
  frame.writeUInt32BE(payload.length, 0)
  payload.copy(frame, 4)
  return frame
}

/**
 * Read protocol frames from the helper's stdout stream until clean EOF.
 * Frame framing errors (an oversized length, trailing bytes) throw; a clean
 * stream end resolves the iterator.
 * @param stream - the child's stdout, spawned in pipe mode.
 * @returns decoded JSON bodies in stream order.
 */
export async function* frames(stream: Readable): AsyncGenerator<unknown, void, unknown> {
  let buffer = Buffer.alloc(0)
  for await (const chunk of stream) {
    buffer = Buffer.concat([buffer, chunk as Buffer])
    while (buffer.length >= 4) {
      const length = buffer.readUInt32BE(0)
      if (length < 1 || length > MAX_FRAME_BYTES) {
        throw new RangeError(`helper frame length ${length} is outside the 1...${MAX_FRAME_BYTES} byte bound`)
      }
      if (buffer.length < 4 + length) break
      yield JSON.parse(buffer.subarray(4, 4 + length).toString('utf8'))
      buffer = buffer.subarray(4 + length)
    }
  }
  if (buffer.length !== 0) {
    throw new RangeError(`helper stream ended with ${buffer.length} trailing bytes inside an unfinished frame`)
  }
}
