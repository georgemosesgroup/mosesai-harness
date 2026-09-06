#!/usr/bin/env node
/**
 * Test-double helper speaking the iossim-helper framed protocol with a canned
 * availability tree. A test fixture, NOT the runtime binary: unlike the real
 * helper it may read the environment (STUB_MARKER) because the provider's
 * no-environment rule binds the shipped binary, not its test doubles.
 */
import { appendFileSync, writeFileSync } from 'node:fs'

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
    if (request.op === 'input') {
      const actedAt = request.params.action === 'tap' || request.params.action === 'text'
        ? { x: request.params.x, y: request.params.y }
        : undefined
      frame({
        id: request.id,
        ok: true,
        result: { simulatorId: request.params.simulatorId ?? 'STUB-A', ...(actedAt === undefined ? {} : { actedAt }) },
      })
    } else if (request.op === 'describe') {
      frame({
        id: request.id,
        ok: true,
        result: {
          simulatorId: request.params.simulatorId ?? 'STUB-A',
          truncated: false,
          root: {
            identifier: 'com.fixture.app',
            type: 'Application',
            label: 'FixtureApp',
            frame: { x: 0, y: 0, width: 393, height: 852 },
            enabled: true,
            children: [
              { type: 'Button', label: 'Continue', frame: { x: 20, y: 100, width: 200, height: 44 }, enabled: true, children: [] },
              { identifier: 'email', type: 'TextField', label: null, frame: { x: 20, y: 200, width: 353, height: 40 }, enabled: false, children: [] },
            ],
          },
          screen: { width: 393, height: 852 },
        },
      })
    } else {
      frame({ id: request.id, ok: false, error: { code: 'SIMULATOR_HELPER_PROTOCOL_BROKEN', message: `unknown op ${String(request.op)}` } })
    }
  }
})
process.stdin.on('end', () => {
  mark('eof\n')
  process.exit(0)
})
process.on('SIGTERM', () => {
  mark('terminated\n')
  process.exit(0)
})
frame({ helper: 'iossim-helper', protocol: 2, ops: ['describe', 'input', 'stream'] })
mark('started\n')
