#!/usr/bin/env node
/**
 * Keyless native-provider snapshot helper: speaks the iossim-helper framed
 * protocol with a deterministic canned availability tree, so the headless
 * snapshot replays without Xcode or a booted device. A fixture, NOT the
 * runtime binary.
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
    if (request.op === 'input') {
      frame({
        id: request.id,
        ok: true,
        result: {
          simulatorId: request.params.simulatorId ?? 'STUB-A',
          actedAt: request.params.action === 'tap' || request.params.action === 'text'
            ? { x: request.params.x, y: request.params.y }
            : undefined,
        },
      })
    } else if (request.op === 'describe') {
      frame({
        id: request.id,
        ok: true,
        result: {
          simulatorId: request.params.simulatorId ?? 'STUB-A',
          truncated: false,
          root: {
            identifier: 'com.fixture.springboard',
            type: 'Application',
            label: 'SnapshotApp',
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
