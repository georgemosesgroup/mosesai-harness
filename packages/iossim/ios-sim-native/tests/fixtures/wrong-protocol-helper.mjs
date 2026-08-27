#!/usr/bin/env node
/**
 * Test double announcing a foreign protocol version. A test fixture, NOT the
 * runtime binary.
 */
const frame = (body) => {
  const payload = Buffer.from(JSON.stringify(body), 'utf8')
  const head = Buffer.alloc(4)
  head.writeUInt32BE(payload.length, 0)
  process.stdout.write(Buffer.concat([head, payload]))
}
frame({ helper: 'iossim-helper', protocol: 99, ops: ['describe'] })
setTimeout(() => process.exit(0), 500)
