/**
 * The simulator panel: a live view of one device's framebuffer over the
 * panel's WebSocket. h264/hevc chunks decode through MediaSource Extensions
 * on a `<video>` element; mjpeg chunks render as images on a canvas. The
 * component owns the socket lifecycle for as long as it is mounted.
 */

import { useEffect, useRef, useState } from 'react'

interface DeviceRow {
  id: string
  name: string
  state: 'booted' | 'shutdown'
}

type ServerMessage =
  | { type: 'devices'; devices: DeviceRow[]; note?: string }
  | { type: 'meta'; codec: string }
  | { type: 'end' }
  | { type: 'error'; message: string }

type StreamCodec = 'h264' | 'hevc' | 'mjpeg'

/**
 * The panel view. Renders the device picker, the connect/start controls, and
 * the live surface; all substrate facts arrive over the socket.
 */
export function SimulatorPanel(): React.JSX.Element {
  const [devices, setDevices] = useState<DeviceRow[]>([])
  const [device, setDevice] = useState<string | undefined>(undefined)
  const [status, setStatus] = useState('连接中…')
  const [error, setError] = useState<string | undefined>(undefined)
  const [inventoryNote, setInventoryNote] = useState<string | undefined>(undefined)
  const [codec, setCodec] = useState<StreamCodec | undefined>(undefined)
  const socketRef = useRef<WebSocket | undefined>(undefined)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const mediaSourceRef = useRef<MediaSource | null>(null)
  const codecRef = useRef<StreamCodec | undefined>(undefined)
  const queueRef = useRef<ArrayBuffer[]>([])

  useEffect(() => {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
    const socket = new WebSocket(`${protocol}://${location.host}/ios-simulator/stream`)
    socket.binaryType = 'arraybuffer'
    socketRef.current = socket

    socket.onopen = () => {
      setStatus('已连接')
    }
    socket.onclose = () => {
      setStatus('连接已断开')
    }
    socket.onerror = () => {
      setError('socket error')
    }

    socket.onmessage = (event: MessageEvent) => {
      if (event.data instanceof ArrayBuffer) {
        if (codecRef.current === 'mjpeg') renderMjpegFrame(event.data)
        else appendEncoded(event.data)
        return
      }
      const message = JSON.parse(event.data as string) as ServerMessage
      switch (message.type) {
        case 'devices':
          setDevices(message.devices)
          setInventoryNote(message.note)
          setStatus(message.devices.length === 0
            ? (message.note ?? '没有已启动的模拟器')
            : (message.devices.some(d => d.state === 'booted') ? '已就绪' : '没有已启动的模拟器'))
          break
        case 'meta':
          setCodec(message.codec as StreamCodec)
          codecRef.current = message.codec as StreamCodec
          setStatus(`直播中（${message.codec}）`)
          if (message.codec !== 'mjpeg') prepareMediaSource(message.codec)
          break
        case 'end':
          setStatus('直播已停止')
          setCodec(undefined)
          codecRef.current = undefined
          break
        case 'error':
          setError(message.message)
          break
      }
    }

    return () => {
      socket.close()
      socketRef.current = undefined
    }
  }, [])

  /** Feed one encoded chunk into the MSE pipeline (h264/hevc). */
  function appendEncoded(chunk: ArrayBuffer): void {
    const mediaSource = mediaSourceRef.current
    const video = videoRef.current
    if (mediaSource === null || video === null) return
    if (mediaSource.readyState !== 'open' || mediaSource.sourceBuffers.length === 0) return
    const sourceBuffer = mediaSource.sourceBuffers[0]
    if (sourceBuffer === undefined || sourceBuffer.updating) {
      queueRef.current.push(chunk)
      return
    }
    try {
      sourceBuffer.appendBuffer(chunk)
    } catch (cause) {
      setError(`解码管线拒绝了一个数据块: ${String(cause)}`)
    }
  }

  function prepareMediaSource(codec: string): void {
    const mimeType = codec === 'hevc' ? 'video/mp4; codecs="hvc1.1.6.L93.B0"' : 'video/mp4; codecs="avc1.640028"'
    const mediaSource = new MediaSource()
    mediaSourceRef.current = mediaSource
    const video = videoRef.current
    if (video === null) return
    video.src = URL.createObjectURL(mediaSource)
    mediaSource.addEventListener('sourceopen', () => {
      try {
        const sourceBuffer = mediaSource.addSourceBuffer(mimeType)
        sourceBuffer.mode = 'segments'
        sourceBuffer.addEventListener('updateend', () => {
          const next = queueRef.current.shift()
          if (next !== undefined && !sourceBuffer.updating) sourceBuffer.appendBuffer(next)
        })
        sourceBuffer.addEventListener('error', () => {
          setError('解码管线报告错误')
        })
      } catch (cause) {
        setError(`MSE 拒绝了 "${mimeType}": ${String(cause)} — 可在设置中切换为 mjpeg`)
      }
    })
  }

  /** Render one mjpeg frame onto the canvas. */
  function renderMjpegFrame(chunk: ArrayBuffer): void {
    const canvas = canvasRef.current
    if (canvas === null) return
    void createImageBitmap(new Blob([chunk], { type: 'image/jpeg' })).then((bitmap) => {
      const context = canvas.getContext('2d')
      if (context === null) return
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      context.drawImage(bitmap, 0, 0)
      bitmap.close()
    }).catch((cause: unknown) => {
      setError(`mjpeg 帧解码失败: ${String(cause)}`)
    })
  }

  function start(): void {
    setError(undefined)
    socketRef.current?.send(JSON.stringify({
      action: 'start',
      ...(device === undefined ? {} : { device }),
    }))
  }

  function stop(): void {
    socketRef.current?.send(JSON.stringify({ action: 'stop' }))
  }

  const streaming = codec !== undefined

  return (
    <div className="simulator-panel">
      <div className="simulator-panel-controls">
        <select
          value={device ?? ''}
          onChange={(event) => {
            setDevice(event.target.value === '' ? undefined : event.target.value)
          }}
        >
          <option value="">自动（唯一已启动设备）</option>
          {devices.map(d => (
            <option key={d.id} value={d.id}>{d.name} [{d.state}]</option>
          ))}
        </select>
        <button type="button" onClick={start} disabled={streaming}>启动</button>
        <button type="button" onClick={stop} disabled={!streaming}>停止</button>
        <span>{status}</span>
        {codec !== undefined && <span>codec: {codec}</span>}
      </div>
      {inventoryNote !== undefined && <div className="simulator-panel-note">{inventoryNote}</div>}
      {error !== undefined && <div className="simulator-panel-error">{error}</div>}
      {codec !== undefined && codec !== 'mjpeg'
        ? <video ref={videoRef} autoPlay muted playsInline />
        : <canvas ref={canvasRef} />}
    </div>
  )
}
