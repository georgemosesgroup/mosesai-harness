#!/usr/bin/env node
/**
 * Test-double helper for one failure scenario. A test fixture, NOT the runtime
 * binary: unlike the real helper it may read the environment (STUB_MARKER)
 * because the provider's no-environment rule binds the shipped binary.
 */
import { appendFileSync } from 'node:fs'

const mark = (text) => {
  if (process.env.STUB_MARKER !== undefined) appendFileSync(process.env.STUB_MARKER, text)
}

const frame = (body) => {
  const payload = Buffer.from(JSON.stringify(body), 'utf8')
  const head = Buffer.alloc(5)
  head.writeUInt32BE(payload.length + 1, 0)
  head.writeUInt8(0, 4)
  process.stdout.write(Buffer.concat([head, payload]))
}

process.stdin.setEncoding('utf8')
process.stdin.on('data', () => {
  // Announces itself, then never answers: the provider's deadline is the
  // only thing that can end this request.
})
// A stuck helper must survive a graceful stdin close: the interval keeps the
// event loop alive past EOF, so only the deadline kill ends it.
process.stdin.on('end', () => {})
setInterval(() => {}, 1 << 30)
process.on('SIGTERM', () => {
  mark('terminated\n')
  process.exit(0)
})
frame({ helper: 'iossim-helper', protocol: 2, ops: ['describe', 'input', 'stream'] })
mark('started\n')
