#!/usr/bin/env node
/**
 * Test double announcing a foreign protocol version. A test fixture, NOT the
 * runtime binary.
 */
const frame = (body) => {
  const payload = Buffer.from(JSON.stringify(body), 'utf8')
  const head = Buffer.alloc(5)
  head.writeUInt32BE(payload.length + 1, 0)
  head.writeUInt8(0, 4)
  process.stdout.write(Buffer.concat([head, payload]))
}
frame({ helper: 'iossim-helper', protocol: 99, ops: ['describe', 'input', 'stream'] })
setTimeout(() => process.exit(0), 500)
