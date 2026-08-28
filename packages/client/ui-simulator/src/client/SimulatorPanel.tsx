/**
 * The simulator panel: a live view of one device's framebuffer over the
 * panel's WebSocket. h264/hevc chunks decode through MediaSource Extensions
 * on a `<video>` element; mjpeg chunks render as images on a canvas. The
 * component owns the socket lifecycle for as long as it is mounted.
 */

import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import styles from './SimulatorPanel.module.css'

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

/** Cap the pre-open chunk queue: the init segment plus a few frames at most. */
const PRE_OPEN_QUEUE_CAP = 16

/**
 * The panel view. Renders the device picker, the connect/start controls, and
 * the live surface; all substrate facts arrive over the socket.
 */
export function SimulatorPanel(): React.JSX.Element {
  const [devices, setDevices] = useState<DeviceRow[]>([])
  const [device, setDevice] = useState<string | undefined>(undefined)
  const [status, setStatus] = useState('连接中…')
  const [error, setError] = useState<string | undefined>(undefined)
  const [autoTargetHint, setAutoTargetHint] = useState(false)
  const [codec, setCodec] = useState<StreamCodec | undefined>(undefined)
  const socketRef = useRef<WebSocket | undefined>(undefined)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const mediaSourceRef = useRef<MediaSource | null>(null)
  const codecRef = useRef<StreamCodec | undefined>(undefined)
  const queueRef = useRef<ArrayBuffer[]>([])
  const sourceOpenRef = useRef(false)

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
      setError('连接错误')
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
          // A provider without the list verb still streams: starting without
          // a device lets the helper resolve the single booted one. The raw
          // diagnostic stays in the console; the panel speaks product copy.
          if (message.note !== undefined) {
            setAutoTargetHint(true)
            console.warn('device inventory unavailable:', message.note)
          }
          setStatus(message.devices.length === 0 ? '就绪 — 点击启动' : '已就绪')
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
          releaseMediaSource()
          break
        case 'error':
          setError(message.message)
          break
      }
    }

    return () => {
      socket.close()
      socketRef.current = undefined
      releaseMediaSource()
    }
  }, [])

  /** Feed one encoded chunk into the MSE pipeline (h264/hevc). */
  function appendEncoded(chunk: ArrayBuffer): void {
    const mediaSource = mediaSourceRef.current
    const video = videoRef.current
    // Chunks that arrive before the source buffer exists — the fMP4 init
    // segment among them — are queued, never dropped: without the init
    // segment the decode pipeline renders nothing.
    if (mediaSource === null || video === null || mediaSource.readyState !== 'open' || mediaSource.sourceBuffers.length === 0) {
      if (queueRef.current.length < PRE_OPEN_QUEUE_CAP) queueRef.current.push(chunk)
      return
    }
    const buffer = mediaSource.sourceBuffers[0]
    if (buffer === undefined) return
    enqueueToSourceBuffer(buffer, chunk)
  }

  function enqueueToSourceBuffer(sourceBuffer: SourceBuffer, chunk: ArrayBuffer): void {
    if (sourceBuffer.updating) {
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
    queueRef.current = []
    sourceOpenRef.current = false
    const mediaSource = new MediaSource()
    mediaSourceRef.current = mediaSource
    const video = videoRef.current
    if (video === null) return
    mediaSource.addEventListener('sourceopen', () => {
      try {
        const buffer = mediaSource.addSourceBuffer(mimeType)
        buffer.mode = 'segments'
        buffer.addEventListener('updateend', () => {
          const next = queueRef.current.shift()
          if (next !== undefined && !buffer.updating) enqueueToSourceBuffer(buffer, next)
        })
        buffer.addEventListener('error', () => {
          setError('解码管线报告错误')
        })
        sourceOpenRef.current = true
        // Flush whatever arrived before the buffer existed (the init segment).
        while (queueRef.current.length > 0 && !buffer.updating) {
          const next = queueRef.current.shift()
          if (next !== undefined) enqueueToSourceBuffer(buffer, next)
        }
      } catch (cause) {
        setError(`MSE 拒绝了 "${mimeType}": ${String(cause)} — 可切换为 mjpeg`)
      }
    })
    video.src = URL.createObjectURL(mediaSource)
    void video.play().catch(() => {
      // Autoplay rejection is benign: the user presses play on the muted element.
    })
  }

  function releaseMediaSource(): void {
    const mediaSource = mediaSourceRef.current
    if (mediaSource !== null && mediaSource.readyState === 'open') {
      try {
        mediaSource.endOfStream()
      } catch {
        // A teardown race (source already ended) is safe to ignore.
      }
    }
    mediaSourceRef.current = null
    queueRef.current = []
    sourceOpenRef.current = false
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
    <div className={styles.panel}>
      <div className={styles.controls}>
        <select
          className={styles.picker}
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
        <button type="button" className={styles.button} onClick={start} disabled={streaming}>启动</button>
        <button type="button" className={styles.button} onClick={stop} disabled={!streaming}>停止</button>
        <span className={clsx(styles.status, streaming && styles.live)}>{status}</span>
      </div>
      {autoTargetHint && !streaming && (
        <div className={styles.note}>未提供设备清单 — 启动时自动选择唯一已启动的模拟器</div>
      )}
      {error !== undefined && <div className={styles.error}>{error}</div>}
      <div className={styles.surface}>
        {codec !== undefined && codec !== 'mjpeg'
          ? <video ref={videoRef} autoPlay muted playsInline className={styles.video} />
          : <canvas ref={canvasRef} className={clsx(styles.canvas, !streaming && styles.hidden)} />}
        {!streaming && <div className={styles.placeholder}>选择设备后点击「启动」观看实时画面</div>}
      </div>
    </div>
  )
}
