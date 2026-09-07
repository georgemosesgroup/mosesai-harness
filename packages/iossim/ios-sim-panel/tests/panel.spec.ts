/**
 * The panel bridge over a REAL composition: a booted WebServer on an
 * OS-assigned port, the panel plugin mounted through cordis, and a FAKE
 * provider whose stream handle yields canned chunks. Asserts the trust
 * fence, the device inventory frame, meta + binary chunk pumping, stop
 * semantics, and the error frame on a substrate failure.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import WebSocket from 'ws'
import { SimulatorError, SimulatorId } from '@deepseek-ai/dsh-ios-sim'
import type { SimulatorCapability, SimulatorDevice, SimulatorStreamHandle } from '@deepseek-ai/dsh-ios-sim'
import { IosSimulator } from '@deepseek-ai/dsh-ios-sim'
import { WebServer } from '@deepseek-ai/dsh-host-webserver'
import * as panel from '../src/index.ts'

/** One 3-chunk canned stream; start records the request for assertions. */
class FakeStreamProvider extends IosSimulator {
  static lastStart: Record<string, unknown> | undefined
  static failStart = false

  override get capabilities(): ReadonlySet<SimulatorCapability> {
    return new Set<SimulatorCapability>(['describe', 'input', 'stream'])
  }

  override get providerName(): string {
    return '@deepseek-ai/fake-panel-sim'
  }

  override async list(): Promise<readonly SimulatorDevice[]> {
    return [
      { id: SimulatorId('UDID-A'), name: 'iPhone 15 Pro', state: 'booted', deviceTypeIdentifier: 'type-a', runtimeIdentifier: 'rt-17' },
    ]
  }

  protected override async doStreamStart(request: Parameters<IosSimulator['startStream']>[0]): Promise<SimulatorStreamHandle> {
    console.log('TRACE doStreamStart entered')
    console.log('TRACE doStreamStart request =', JSON.stringify(request))
    FakeStreamProvider.lastStart = { ...request }
    console.log('TRACE doStreamStart lastStart set, failStart =', FakeStreamProvider.failStart)
    if (FakeStreamProvider.failStart) {
      console.log('TRACE doStreamStart about to throw')
      throw new SimulatorError('the framebuffer is taken by the presenting app', 'SIMULATOR_HELPER_REQUEST_FAILED')
    }
    async function* frames(): AsyncIterable<Uint8Array> {
      yield new Uint8Array([1])
      yield new Uint8Array([2, 2])
      yield new Uint8Array([3, 3, 3])
      await new Promise(resolve => setTimeout(resolve, 30))
    }
    return {
      codec: 'h264',
      frames: frames(),
      stop: async () => {},
    }
  }
}

/** Advertises nothing: every verb rides the Service Definition gate. */
class BareProvider extends IosSimulator {
  override get capabilities(): ReadonlySet<SimulatorCapability> {
    return new Set<SimulatorCapability>()
  }

  override get providerName(): string {
    return '@deepseek-ai/bare-panel-sim'
  }
}

const sockets: WebSocket[] = []
const closes: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const socket of sockets.splice(0)) {
    try {
      socket.close()
    } catch {
      // A fenced or destroyed socket is already dead; closing it again is a no-op.
    }
  }
  for (const close of closes.splice(0)) await close()
})

/** Boot one real composition: WebServer (port 0) + provider + panel bridge. */
interface MountedPanel {
  url: string
  close: () => Promise<void>
}

async function mounted(providerClass: typeof FakeStreamProvider | typeof BareProvider): Promise<MountedPanel> {
  const ctx = new Context()
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  await ctx.plugin(providerClass)
  await ctx.plugin(panel)
  const url = `ws://127.0.0.1:${String(ctx.webServer.port)}/ios-simulator/stream`
  return {
    url,
    close: async () => {
      await ctx.fiber.dispose()
    },
  }
}

interface Frame {
  type: string
  payload?: Uint8Array
  devices?: Array<{ id: string; name: string; state: string; deviceTypeIdentifier?: string; runtimeIdentifier?: string }>
  codec?: string
  message?: string
}

/** Collect socket messages until the predicate matches; returns them all. */
async function collect(socket: WebSocket, until: (frame: Frame) => boolean): Promise<Frame[]> {
  const seen: Frame[] = []
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`panel messages stalled; seen ${JSON.stringify(seen)}`))
    }, 5_000)
    socket.on('message', (data: Buffer, isBinary: boolean) => {
      const frame = isBinary
        ? { type: 'chunk', payload: new Uint8Array(data) }
        : JSON.parse(data.toString('utf8')) as Frame
      seen.push(frame)
      if (until(frame)) {
        clearTimeout(timer)
        resolve(seen)
      }
    })
    socket.on('close', () => {
      clearTimeout(timer)
      reject(new Error(`socket closed early; seen ${JSON.stringify(seen)}`))
    })
  })
}

describe('the panel bridge', () => {
  it('sends the device inventory on connect', async () => {
    const { url, close } = await mounted(FakeStreamProvider)
    closes.push(close)
    const socket = new WebSocket(url)
    sockets.push(socket)
    const seen = await collect(socket, frame => frame.type === 'devices')
    expect(seen[0]).toEqual({
      type: 'devices',
      devices: [{ id: 'UDID-A', name: 'iPhone 15 Pro', state: 'booted', deviceTypeIdentifier: 'type-a', runtimeIdentifier: 'rt-17' }],
    })
  })

  it('pumps meta then binary chunks after start, and ends on stop', async () => {
    const { url, close } = await mounted(FakeStreamProvider)
    closes.push(close)
    const socket = new WebSocket(url)
    sockets.push(socket)
    await collect(socket, frame => frame.type === 'devices')
    socket.send(JSON.stringify({ action: 'start' }))
    const seen = await collect(socket, frame => frame.type === 'end')
    expect(seen.some(f => f.type === 'meta' && f.codec === 'h264')).toBe(true)
    const chunks = seen.filter(f => f.type === 'chunk').map(f => [...(f.payload ?? [])])
    expect(chunks).toEqual([[1], [2, 2], [3, 3, 3]])
    // A bare start carries no knobs: the provider's configuration decides.
    expect(FakeStreamProvider.lastStart).toEqual({})
    socket.send(JSON.stringify({ action: 'stop' }))
    await collect(socket, frame => frame.type === 'end')
  }, 10_000)

  it('passes the requested knobs through to the provider', async () => {
    const { url, close } = await mounted(FakeStreamProvider)
    closes.push(close)
    const socket = new WebSocket(url)
    sockets.push(socket)
    await collect(socket, frame => frame.type === 'devices')
    socket.send(JSON.stringify({ action: 'start', device: 'UDID-B', codec: 'mjpeg', frameRate: 24, scale: 0.5 }))
    await collect(socket, frame => frame.type === 'meta')
    expect(FakeStreamProvider.lastStart).toEqual({
      simulator: 'UDID-B',
      codec: 'mjpeg',
      frameRate: 24,
      scale: 0.5,
    })
  }, 10_000)

  it('surfaces a substrate failure as an error frame', async () => {
    FakeStreamProvider.failStart = true
    const { url, close } = await mounted(FakeStreamProvider)
    closes.push(close)
    const socket = new WebSocket(url)
    sockets.push(socket)
    await collect(socket, frame => frame.type === 'devices')
    socket.send(JSON.stringify({ action: 'start' }))
    const seen = await collect(socket, frame => frame.type === 'error')
    expect(seen[seen.length - 1]?.message).toContain('framebuffer is taken')
    FakeStreamProvider.failStart = false
  }, 10_000)

  it('fences untrusted upgrades: a rebound Host gets no socket', async () => {
    const { url, close } = await mounted(FakeStreamProvider)
    closes.push(close)
    const socket = new WebSocket(url, { headers: { host: 'attacker.example' } })
    sockets.push(socket)
    await expect(new Promise<void>((resolve, reject) => {
      socket.on('open', () => {
        reject(new Error('the fence let a rebound socket through'))
      })
      socket.on('error', () => {
        resolve()
      })
      socket.on('close', () => {
        resolve()
      })
    })).resolves.toBeUndefined()
  })

  it('gates a start on a provider that advertises nothing, after a noted empty inventory', async () => {
    const { url, close } = await mounted(BareProvider)
    closes.push(close)
    const socket = new WebSocket(url)
    sockets.push(socket)
    // The inventory degrades to a noted empty list: a provider without the
    // list verb still streams via the helper's own booted-device resolution.
    const inventory = await collect(socket, frame => frame.type === 'devices')
    const devicesFrame = inventory[0] as { devices: unknown[]; note?: string }
    expect(devicesFrame.devices).toEqual([])
    expect(devicesFrame.note).toContain('does not declare the "list" capability')
    // The verb gate then refuses the start itself.
    socket.send(JSON.stringify({ action: 'start' }))
    const seen = await collect(socket, frame => frame.type === 'error')
    const last = seen[seen.length - 1] as { message: string; code?: string }
    expect(last.message).toContain('does not declare the "stream" capability')
    expect(last.code).toBe('SIMULATOR_CAPABILITY_UNAVAILABLE')
  })
})
