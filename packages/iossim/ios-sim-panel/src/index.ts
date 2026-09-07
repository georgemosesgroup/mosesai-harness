/**
 * WebSocket bridge for the iOS-simulator panel: one upgrade route that pumps
 * the mounted provider's live stream and device inventory to the Web GUI.
 *
 * Protocol (JSON control over the socket, binary video toward the browser):
 * server -> client: {type: 'devices', devices: [{id, name, state,
 * deviceTypeIdentifier, runtimeIdentifier}]} on connect, {type: 'meta',
 * codec} when a stream starts, binary chunks after it, {type: 'end'} when
 * it stops, {type: 'error', message, code?} on failure. client -> server:
 * {action: 'start', device?, codec?, frameRate?, scale?} and
 * {action: 'stop'}. One stream per socket; a new start stops the previous.
 *
 * The route rides the webserver's upgrade registry and the same browser-trust
 * fence as the API routes (loopback Host fence + cross-site/Origin checks).
 * @module @deepseek-ai/dsh-ios-sim-panel
 */

import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { SimulatorId } from '@deepseek-ai/dsh-ios-sim'
import type { IosSimulator, SimulatorHardwareButton, SimulatorInputAction, SimulatorStreamCodec, SimulatorStreamHandle } from '@deepseek-ai/dsh-ios-sim'
import { SimulatorError } from '@deepseek-ai/dsh-ios-sim'
import type { WebUpgradeRoute } from '@deepseek-ai/dsh-host-webserver'
import { WebSocketServer, WebSocket } from 'ws'

/** The upgrade route's default pathname. */
const DEFAULT_PATH = '/ios-simulator/stream'

/** Plugin config (all optional). */
export interface Config {
  /** Absolute pathname of the upgrade route. Default: /ios-simulator/stream. */
  path?: string
  /** Extra trusted Host authorities beyond loopback (DNS-rebinding fence). */
  trustedHosts?: string[]
}

type SocketMessage = {
  action?: unknown
  device?: unknown
  codec?: unknown
  frameRate?: unknown
  scale?: unknown
  gesture?: unknown
  name?: unknown
  deviceTypeIdentifier?: unknown
  runtimeIdentifier?: unknown
}

/**
 * Parse one panel gesture into the seam's input action. Coordinates are
 * device POINTS — the panel owns the pixel→point mapping, because only it
 * sees how the surface is laid out.
 * @param gesture - the socket message's `gesture` payload.
 * @returns the typed action, or undefined when the payload is unusable.
 */
function inputActionFrom(gesture: unknown): SimulatorInputAction | undefined {
  if (typeof gesture !== 'object' || gesture === null) return undefined
  const g = gesture as Record<string, unknown>
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
  if (g.type === 'tap' && num(g.x) && num(g.y)) {
    return { kind: 'tap', target: { kind: 'point', at: { xPoints: g.x, yPoints: g.y } } }
  }
  if (g.type === 'key' && num(g.usage)) {
    return { kind: 'key', usage: Math.trunc(g.usage), ...(g.shift === true ? { shift: true } : {}) }
  }
  if (g.type === 'button' && typeof g.name === 'string') {
    const known: readonly SimulatorHardwareButton[] = ['home', 'lock', 'side_button', 'siri', 'apple_pay', 'play_pause']
    const button = known.find(b => b === g.name)
    if (button !== undefined) return { kind: 'button', button }
    return undefined
  }
  if (g.type === 'swipe' && num(g.xStart) && num(g.yStart) && num(g.xEnd) && num(g.yEnd)) {
    return {
      kind: 'swipe',
      start: { xPoints: g.xStart, yPoints: g.yStart },
      end: { xPoints: g.xEnd, yPoints: g.yEnd },
      ...(num(g.durationMs) ? { durationMs: Math.min(Math.max(g.durationMs, 50), 2000) } : {}),
    }
  }
  return undefined
}

export const name = 'ios-sim-panel'
export const inject = ['webServer', 'iosSimulator']

export const Config: z<Config> = z.object({
  path: z.string().default(DEFAULT_PATH),
  trustedHosts: z.array(String).default([]),
})

const wss = new WebSocketServer({ noServer: true })

/**
 * The panel route's browser-trust fence (loopback Host + cross-site/Origin),
 * the same defense the /api proxy applies — inlined because the fence is a
 * per-surface policy, not a shared client-plane service.
 */
function isTrustedPanelUpgrade(req: IncomingMessage, trustedHosts: readonly string[]): boolean {
  const host = req.headers.host
  if (host === undefined) return false
  let hostUrl: URL
  try {
    hostUrl = new URL(`http://${host}`)
  } catch {
    return false
  }
  const hostname = hostUrl.hostname
  const isLoopback = hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]'
      || hostname === '[::ffff:127.0.0.1]'
  if (!isLoopback && !trustedHosts.includes(hostUrl.host)) return false
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = req.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

function send(ws: WebSocket, body: object): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(body))
}

function errorBody(error: unknown): { type: 'error'; message: string; code?: string } {
  const body: { type: 'error'; message: string; code?: string } = {
    type: 'error',
    message: error instanceof Error ? error.message : String(error),
  }
  if (error instanceof SimulatorError) body.code = error.code
  return body
}

/**
 * Bridge one accepted socket to the mounted provider: device inventory on
 * connect, one live stream per socket, stop on close.
 * @param simulator - the mounted simulator provider.
 * @param ws - the accepted WebSocket.
 */
export function bridge(simulator: IosSimulator, ws: WebSocket): void {
  let stream: SimulatorStreamHandle | undefined
  // The device the last stream started against: gestures target the screen
  // the viewer is looking at, never a differently-resolved one.
  let streamDevice: ReturnType<typeof SimulatorId> | undefined

  const stopStream = async (): Promise<void> => {
    const active = stream
    stream = undefined
    if (active !== undefined) await active.stop()
  }

  /** Pump one handle's chunks until it is replaced, stopped, or the socket dies. */
  const pump = async (active: SimulatorStreamHandle): Promise<void> => {
    try {
      for await (const chunk of active.frames) {
        if (ws.readyState !== WebSocket.OPEN || stream !== active) break
        ws.send(chunk)
      }
      if (stream === active) {
        stream = undefined
        send(ws, { type: 'end' })
      }
    } catch (cause) {
      if (stream === active) stream = undefined
      if (ws.readyState === WebSocket.OPEN) send(ws, errorBody(cause))
    }
  }

  const startStream = async (message: SocketMessage): Promise<void> => {
    await stopStream()
    const request = {
      ...(typeof message.device === 'string' && message.device.length > 0
        ? { simulator: SimulatorId(message.device) }
        : {}),
      ...(typeof message.codec === 'string' && ['h264', 'hevc', 'mjpeg'].includes(message.codec)
        ? { codec: message.codec as SimulatorStreamCodec }
        : {}),
      ...(typeof message.frameRate === 'number' ? { frameRate: message.frameRate } : {}),
      ...(typeof message.scale === 'number' ? { scale: message.scale } : {}),
    }
    stream = await simulator.startStream(request)
    streamDevice = request.simulator
    send(ws, { type: 'meta', codec: stream.codec })
    void pump(stream)
    // Attested geometry, best-effort: the panel maps clicks to device POINTS,
    // and describe's screen size replaces its render-scale heuristic. A
    // failing describe costs nothing — the panel keeps the heuristic.
    void simulator.describe({ ...(streamDevice === undefined ? {} : { simulator: streamDevice }) }).then(
      (described) => {
        if (described.screen !== undefined) {
          send(ws, { type: 'screen', widthPoints: described.screen.widthPoints, heightPoints: described.screen.heightPoints })
        }
      },
      () => undefined,
    )
  }

  const sendDevices = async (): Promise<void> => {
    try {
      const devices = await simulator.list()
      send(ws, {
        type: 'devices',
        // The substrate identifiers ride along so the panel can group by model
        // and tell two runtimes of one model apart; labels are the panel's.
        devices: devices.map(d => ({
          id: String(d.id),
          name: d.name,
          state: d.state,
          deviceTypeIdentifier: d.deviceTypeIdentifier,
          runtimeIdentifier: d.runtimeIdentifier,
        })),
      })
    } catch (cause) {
      // A provider without the list verb still streams: starting without a
      // device lets the helper resolve the single booted one.
      send(ws, { type: 'devices', devices: [], note: errorBody(cause).message })
    }
  }

  const sendDeviceTypes = async (): Promise<void> => {
    try {
      const catalog = await simulator.listDeviceTypes()
      send(ws, { type: 'deviceTypes', deviceTypes: catalog.deviceTypes, runtimes: catalog.runtimes })
    } catch (cause) {
      send(ws, errorBody(cause))
    }
  }

  void sendDevices()

  ws.on('message', (data: Buffer) => {
    let message: SocketMessage
    try {
      message = JSON.parse(data.toString('utf8')) as SocketMessage
    } catch {
      send(ws, { type: 'error', message: 'panel messages must be JSON' })
      return
    }
    if (message.action === 'start') {
      startStream(message).catch((cause: unknown) => {
        send(ws, errorBody(cause))
      })
      return
    }
    if (message.action === 'input') {
      const action = inputActionFrom(message.gesture)
      if (action === undefined) {
        send(ws, { type: 'error', message: 'unusable input gesture' })
        return
      }
      simulator.input({ action, ...(streamDevice === undefined ? {} : { simulator: streamDevice }) }).then(
        () => {
          send(ws, { type: 'inputResult', ok: true })
        },
        (cause: unknown) => {
          send(ws, errorBody(cause))
        },
      )
      return
    }
    if (message.action === 'refresh') {
      void sendDevices()
      return
    }
    if (message.action === 'deviceTypes') {
      void sendDeviceTypes()
      return
    }
    if (message.action === 'boot' || message.action === 'shutdown') {
      const id = typeof message.device === 'string' && message.device.length > 0 ? SimulatorId(message.device) : undefined
      if (id === undefined) { send(ws, { type: 'error', message: 'boot/shutdown needs a device id' }); return }
      const verb = message.action === 'boot' ? simulator.boot({ simulator: id }) : simulator.shutdown({ simulator: id })
      verb.then(
        () => { void sendDevices() },
        (cause: unknown) => { send(ws, errorBody(cause)) },
      )
      return
    }
    if (message.action === 'create') {
      if (typeof message.name !== 'string' || typeof message.deviceTypeIdentifier !== 'string' || typeof message.runtimeIdentifier !== 'string') {
        send(ws, { type: 'error', message: 'create needs name, deviceTypeIdentifier, runtimeIdentifier' })
        return
      }
      simulator.create({
        name: message.name,
        deviceTypeIdentifier: message.deviceTypeIdentifier,
        runtimeIdentifier: message.runtimeIdentifier,
      }).then(
        (device) => { send(ws, { type: 'created', id: String(device.id), name: device.name }); void sendDevices() },
        (cause: unknown) => { send(ws, errorBody(cause)) },
      )
      return
    }
    if (message.action === 'stop') {
      stopStream().then(
        () => {
          send(ws, { type: 'end' })
        },
        (cause: unknown) => {
          send(ws, errorBody(cause))
        },
      )
    }
  })
  ws.on('close', () => {
    void stopStream()
  })
  ws.on('error', () => {
    void stopStream()
  })
}

/**
 * Register the panel's WebSocket upgrade route.
 * @param ctx - composition context; injects webServer and iosSimulator.
 * @param config - validated plugin config.
 */
export function apply(ctx: Context, config: Config): void {
  const path = config.path ?? DEFAULT_PATH
  const trustedHosts = config.trustedHosts ?? []
  const route: WebUpgradeRoute = {
    path,
    handler: (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
      if (!isTrustedPanelUpgrade(req, trustedHosts)) {
        socket.destroy()
        return
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        bridge(ctx.iosSimulator, ws)
      })
    },
  }
  ctx.effect(() => ctx.webServer.registerUpgrade(route), 'ios-sim-panel: WebSocket route')
  ctx.effect(() => () => {
    for (const client of wss.clients) client.terminate()
  }, 'ios-sim-panel: socket teardown')
}
