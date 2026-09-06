#!/usr/bin/env node
/** Test double answering describe with NAMED error frames: the first request
 * gets a seam code, the second a foreign one — both classify at the provider.
 * A fixture, NOT the runtime binary. */
const frame = (body) => {
  const payload = Buffer.from(JSON.stringify(body), 'utf8')
  const head = Buffer.alloc(5)
  head.writeUInt32BE(payload.length + 1, 0)
  head.writeUInt8(0, 4)
  process.stdout.write(Buffer.concat([head, payload]))
}
frame({ helper: 'iossim-helper', protocol: 2, ops: ['describe', 'input', 'stream'] })
let requests = 0
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
    requests += 1
    frame({
      id: request.id,
      ok: false,
      error: requests === 1
        ? { code: 'SIMULATOR_DEVICE_NOT_FOUND', message: 'no available simulator matches "GHOST" (0 visible)' }
        : { code: 'WEIRD_SUBSTRATE_FAILURE', message: 'the substrate refused for an undocumented reason' },
    })
  }
})
process.stdin.on('end', () => process.exit(0))
