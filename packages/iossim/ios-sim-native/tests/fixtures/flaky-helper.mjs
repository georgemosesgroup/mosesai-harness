#!/usr/bin/env node
/**
 * Test-double helper for one failure scenario. A test fixture, NOT the runtime
 * binary: unlike the real helper it may read the environment (STUB_MARKER)
 * because the provider's no-environment rule binds the shipped binary.
 */
import { appendFileSync, readFileSync } from 'node:fs'

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

let stdin = ''
let requests = 0
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
    // Die on the first request EVER (marker-shared across restarts): a fresh
    // process after the supervised restart answers instead of dying again.
    if (requests === 1 && !(process.env.STUB_MARKER !== undefined && readFileSync(process.env.STUB_MARKER, 'utf8').includes('died-on-first'))) {
      mark('died-on-first\n')
      process.exit(9)
    }
    frame({
      id: request.id,
      ok: true,
      result: { simulatorId: request.params.simulatorId ?? 'STUB-A', truncated: false, root: null },
    })
  }
})
process.stdin.on('end', () => {
  mark('eof\n')
  process.exit(0)
})
frame({ helper: 'iossim-helper', protocol: 2, ops: ['describe', 'input', 'stream'] })
mark('started\n')
