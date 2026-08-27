#!/usr/bin/env node
/** Test double answering every request with the WRONG frame id — the
 * request/response pairing breach. A fixture, NOT the runtime binary. */
const frame = (body) => {
  const payload = Buffer.from(JSON.stringify(body), 'utf8')
  const head = Buffer.alloc(5)
  head.writeUInt32BE(payload.length + 1, 0)
  head.writeUInt8(0, 4)
  process.stdout.write(Buffer.concat([head, payload]))
}
frame({ helper: 'iossim-helper', protocol: 2, ops: ['describe', 'input', 'stream'] })
let stdin = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  stdin += chunk
  for (;;) {
    if (stdin.length < 4) return
    const length = Buffer.from(stdin.slice(0, 4), 'binary').readUInt32BE(0)
    if (stdin.length < 4 + length) return
    const body = stdin.slice(5, 4 + length)
    stdin = stdin.slice(4 + length)
    const request = JSON.parse(body)
    frame({ id: request.id + 100, ok: true, result: { simulatorId: 'STUB-A', truncated: false, root: null } })
  }
})
process.stdin.on('end', () => process.exit(0))
