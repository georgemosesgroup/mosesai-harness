#!/usr/bin/env node
/**
 * Test double that serves the stream op: after `stream-start` it emits three
 * deterministic type-1 video chunks, then answers `stream-stop`. A fixture,
 * NOT the runtime binary.
 */
const frame = (type, payload) => {
  const head = Buffer.alloc(5)
  head.writeUInt32BE(payload.length + 1, 0)
  head.writeUInt8(type, 4)
  process.stdout.write(Buffer.concat([head, payload]))
}
const frameJSON = (body) => frame(0, Buffer.from(JSON.stringify(body), 'utf8'))

frameJSON({ helper: 'iossim-helper', protocol: 2, ops: ['describe', 'input', 'stream'] })

let stdin = ''
let streaming = false
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  stdin += chunk
  for (;;) {
    if (stdin.length < 5) return
    const length = Buffer.from(stdin.slice(0, 4), 'binary').readUInt32BE(0)
    if (stdin.length < 4 + length) return
    const body = stdin.slice(5, 4 + length)
    stdin = stdin.slice(4 + length)
    const request = JSON.parse(body)
    if (request.op === 'stream-start') {
      streaming = true
      frameJSON({ id: request.id, ok: true, result: { simulatorId: 'STUB-A', codec: request.params.codec ?? 'h264' } })
      for (const byte of [11, 22, 33]) {
        if (streaming) frame(1, Buffer.from([byte]))
      }
    } else if (request.op === 'stream-stop') {
      streaming = false
      frameJSON({ id: request.id, ok: true, result: { stopped: true } })
    } else {
      frameJSON({ id: request.id, ok: true, result: {} })
    }
  }
})
process.stdin.on('end', () => process.exit(0))
