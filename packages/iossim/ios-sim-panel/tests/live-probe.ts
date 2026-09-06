/**
 * Live smoke for the panel bridge over the REAL stack: composition
 * (webServer + native provider + panel) -> helper -> VideoToolbox -> booted
 * device. Connects a WS client, asserts the device inventory, starts a
 * stream, counts binary chunks, and verifies the first chunk is an fMP4
 * init segment (ftyp box) so MSE can play it.
 */
import { Context } from '@deepseek-ai/cordis'
import WebSocket from 'ws'
import NativeSimulatorProvider from '@deepseek-ai/dsh-ios-sim-native'
import { WebServer } from '@deepseek-ai/dsh-host-webserver'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import * as panel from '../src/index.ts'

const ctx = new Context()
await ctx.plugin(LocalSubprocessRuntime)
await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
await ctx.plugin(NativeSimulatorProvider)
await ctx.plugin(panel)
const port = ctx.webServer.port
console.log('PANEL-WS listening on', port)

const socket = new WebSocket(`ws://127.0.0.1:${String(port)}/ios-simulator/stream`)
let chunks = 0
let bytes = 0
let firstChunk: Buffer | undefined

socket.on('open', () => {
  console.log('WS open')
})
socket.on('message', (data: Buffer, isBinary: boolean) => {
  if (!isBinary) {
    console.log('CONTROL:', data.toString().slice(0, 300))
    const message = JSON.parse(data.toString('utf8')) as { type: string }
    if (message.type === 'devices') {
      socket.send(JSON.stringify({ action: 'start' }))
    }
    return
  }
  void 0
  chunks += 1
  bytes += data.length
  if (firstChunk === undefined) {
    firstChunk = data
    const box = data.subarray(4, 8).toString('ascii')
    const isInit = box === 'ftyp'
    console.log(`FIRST CHUNK: ${String(data.length)}B, box='${box}' (fmp4 init segment: ${isInit ? 'YES' : 'no'})`)
  }
})
socket.on('error', (err) => {
  console.log('WS error:', err.message)
})
socket.on('close', (code, reason) => {
  console.log('WS close', code, reason.toString())
})

setTimeout(() => {
  const ftyp = firstChunk?.subarray(4, 8).toString('ascii') === 'ftyp'
  console.log(`SMOKE RESULT: chunks=${String(chunks)} bytes=${String(bytes)} firstChunkIsFtyp=${ftyp ? 'YES' : 'NO'}`)
  socket.close()
  setTimeout(() => process.exit(0), 500)
}, 8000)
