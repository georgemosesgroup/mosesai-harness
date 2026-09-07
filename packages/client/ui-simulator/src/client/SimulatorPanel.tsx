/**
 * The simulator panel: a live view of one device's framebuffer over the
 * panel's WebSocket. h264/hevc chunks decode through MediaSource Extensions
 * on a `<video>` element; mjpeg chunks render as images on a canvas. The
 * component owns the socket lifecycle for as long as it is mounted.
 */

import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  Button, IconChevronDownOutline14, IconLoadingOutline16, IconPlayOutline16, IconPlusOutline16,
  IconStopFill16, IconWarningOutline16, Input, Menu, StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import {
  deviceChipLabel, deviceRowLabel, groupDevices, type DeviceRow,
} from './device-inventory.ts'
import styles from './SimulatorPanel.module.css'

interface DeviceTypeRow { identifier: string; name: string }
interface RuntimeRow { identifier: string; name: string; available: boolean }

type ServerMessage =
  | { type: 'devices'; devices: DeviceRow[]; note?: string }
  | { type: 'meta'; codec: string }
  | { type: 'screen'; widthPoints: number; heightPoints: number }
  | { type: 'inputResult'; ok: boolean }
  | { type: 'deviceTypes'; deviceTypes: DeviceTypeRow[]; runtimes: RuntimeRow[] }
  | { type: 'created'; id: string; name: string }
  | { type: 'end' }
  | { type: 'error'; message: string }

type StreamCodec = 'h264' | 'hevc' | 'mjpeg'

/**
 * Bound the pre-open chunk queue by bytes, not messages. fMP4 is a byte
 * stream: dropping ANY chunk tears it and the demuxer dies on mid-frame
 * bytes at a box boundary. At ~230 KB/s even seconds of pre-open backlog
 * are small; the bound only guards a stuck pipeline, and hitting it stops
 * the feed loudly instead of corrupting it silently.
 */
const PRE_OPEN_QUEUE_MAX_BYTES = 32 * 1024 * 1024

/** Props: the slot's locale seat for this plugin's `simulator` namespace. */
export type SimulatorPanelProps = PropsLocale<'simulator'>

/**
 * The panel view. Renders the device picker, the connect/start controls, and
 * the live surface; all substrate facts arrive over the socket. Status and
 * error state hold dictionary KEYS (plus an optional literal detail), so the
 * rendered copy always follows the active locale.
 */
export function SimulatorPanel(props: SimulatorPanelProps): React.JSX.Element {
  const { t } = props
  const [devices, setDevices] = useState<DeviceRow[]>([])
  const [device, setDevice] = useState<string | undefined>(undefined)
  const [status, setStatus] = useState<{ key: Parameters<typeof t>[0]; detail?: string }>({ key: 'status.connecting' })
  const [error, setError] = useState<{ key: Parameters<typeof t>[0]; detail?: string } | undefined>(undefined)
  const [autoTargetHint, setAutoTargetHint] = useState(false)
  const [codec, setCodec] = useState<StreamCodec | undefined>(undefined)
  const [deviceTypes, setDeviceTypes] = useState<DeviceTypeRow[]>([])
  const [runtimes, setRuntimes] = useState<RuntimeRow[]>([])
  const [creating, setCreating] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState('')
  const [newRuntime, setNewRuntime] = useState('')
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
      setStatus({ key: 'status.connected' })
    }
    socket.onclose = () => {
      setStatus({ key: 'status.disconnected' })
    }
    socket.onerror = () => {
      setError({ key: 'error.connection' })
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
          setStatus(message.devices.length === 0 ? { key: 'status.readyClickStart' } : { key: 'status.ready' })
          break
        case 'meta':
          setCodec(message.codec as StreamCodec)
          codecRef.current = message.codec as StreamCodec
          setStatus({ key: 'status.live', detail: `(${message.codec})` })
          break
        case 'screen':
          screenRef.current = { widthPoints: message.widthPoints, heightPoints: message.heightPoints }
          break
        case 'inputResult':
          break
        case 'deviceTypes':
          setDeviceTypes(message.deviceTypes)
          setRuntimes(message.runtimes)
          const firstType = message.deviceTypes[0]
          if (firstType !== undefined) setNewType(prev => prev === '' ? firstType.identifier : prev)
          {
            // Newest available runtime, not the first: simctl lists runtimes
            // oldest-first, and the oldest is the one least likely to back a
            // current device type (iPhone 17 Pro needs iOS 26+, not 17.5).
            const available = message.runtimes.filter(r => r.available)
            const newest = available[available.length - 1]
            if (newest !== undefined) setNewRuntime(prev => prev === '' ? newest.identifier : prev)
          }
          break
        case 'created':
          setCreating(false)
          setNewName('')
          setDevice(message.id)
          setError(undefined)
          break
        case 'end':
          setStatus({ key: 'status.stopped' })
          setCodec(undefined)
          codecRef.current = undefined
          releaseMediaSource()
          break
        case 'error':
          setError({ key: 'error.connection', detail: message.message })
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
      const queued = queueRef.current.reduce((sum, c) => sum + c.byteLength, 0)
      if (queued + chunk.byteLength > PRE_OPEN_QUEUE_MAX_BYTES) {
        setError({ key: 'error.queueOverflow' })
        socketRef.current?.send(JSON.stringify({ action: 'stop' }))
        return
      }
      queueRef.current.push(chunk)
      return
    }
    const buffer = mediaSource.sourceBuffers[0]
    if (buffer === undefined) return
    // Strict FIFO: the chunk always joins the tail, and appends always take
    // the head. Appending the fresh chunk directly would let it overtake
    // queued ones whenever a WebSocket message lands between an append
    // completing (updating flips false) and its updateend task running —
    // reordering the fMP4 byte sequence, which the demuxer answers with
    // "invalid top-level box" on mid-frame bytes.
    queueRef.current.push(chunk)
    pumpSourceBuffer(buffer)
  }

  function pumpSourceBuffer(sourceBuffer: SourceBuffer): void {
    if (sourceBuffer.updating) return
    const next = queueRef.current.shift()
    if (next === undefined) return
    try {
      sourceBuffer.appendBuffer(next)
    } catch (cause) {
      setError({ key: 'error.chunkRefused', detail: String(cause) })
    }
  }

  // The MediaSource lifecycle runs in an effect: the `<video>` element is
  // mounted by the same codec state, and the element must exist before the
  // blob URL can be assigned (sourceopen never fires otherwise).
  useEffect(() => {
    if (codec === undefined || codec === 'mjpeg') return
    prepareMediaSource(codec)
    return () => {
      releaseMediaSource()
    }
  }, [codec])

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
          pumpSourceBuffer(buffer)
          holdLiveEdge()
        })
        buffer.addEventListener('error', () => {
          setError({ key: 'error.decodePipeline' })
        })
        sourceOpenRef.current = true
        // Drain what arrived before the buffer existed (the init segment
        // among it): one append now, the updateend pump takes the rest.
        pumpSourceBuffer(buffer)
      } catch (cause) {
        setError({ key: 'error.mseRejected', detail: `${mimeType}: ${String(cause)}` })
      }
    })
    video.src = URL.createObjectURL(mediaSource)
    void video.play().catch(() => {
      // Autoplay rejection is benign: the user presses play on the muted element.
    })
  }

  /**
   * Keep the element at the stream's live edge. MSE appends only buffer the
   * feed: playback stays where it was, so without this the view drifts by
   * exactly the buffered backlog (it starts at t=0, seconds behind the
   * device). A paused element is also retried here — the browser rejects
   * autoplay in a backgrounded pane, and nothing else would ever retry.
   */
  function holdLiveEdge(): void {
    const video = videoRef.current
    if (video === null || video.buffered.length === 0) return
    const edge = video.buffered.end(video.buffered.length - 1)
    if (edge - video.currentTime > 1.5) video.currentTime = Math.max(0, edge - 0.3)
    if (video.paused) void video.play().catch(() => undefined)
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
      setError({ key: 'error.mjpegFrame', detail: String(cause) })
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

  function bootDevice(id: string): void {
    socketRef.current?.send(JSON.stringify({ action: 'boot', device: id }))
  }

  function shutdownDevice(id: string): void {
    socketRef.current?.send(JSON.stringify({ action: 'shutdown', device: id }))
  }

  function openCreate(): void {
    setCreating(true)
    socketRef.current?.send(JSON.stringify({ action: 'deviceTypes' }))
  }

  function submitCreate(): void {
    if (newName.trim() === '' || newType === '' || newRuntime === '') return
    setError(undefined)
    socketRef.current?.send(JSON.stringify({
      action: 'create',
      name: newName.trim(),
      deviceTypeIdentifier: newType,
      runtimeIdentifier: newRuntime,
    }))
  }

  /** CSS-пиксели порога: ближе — тап, дальше — свайп. */
  const SWIPE_MIN_CSS_PX = 8

  const gestureRef = useRef<{ clientX: number; clientY: number; startedAt: number; point: { x: number; y: number } } | undefined>(undefined)
  /** Attested screen size in points, sent by the bridge when describe serves. */
  const screenRef = useRef<{ widthPoints: number; heightPoints: number } | undefined>(undefined)

  /**
   * Map one pointer event onto the device's POINT grid. The stream carries
   * pixels; the point size is pixels over the render scale, recovered from
   * the plausible point-width bands of real devices (phones 250–520 pt at
   * 3x, tablets 500–1100 pt at 2x). `describe` would attest this exactly,
   * but it is not yet servable, and a wrong band is impossible for shipping
   * hardware today.
   */
  function devicePointFrom(event: React.PointerEvent, surface: HTMLVideoElement | HTMLCanvasElement): { x: number; y: number } | undefined {
    const rect = surface.getBoundingClientRect()
    const pxWidth = surface instanceof HTMLVideoElement ? surface.videoWidth : surface.width
    const pxHeight = surface instanceof HTMLVideoElement ? surface.videoHeight : surface.height
    if (pxWidth === 0 || pxHeight === 0 || rect.width === 0 || rect.height === 0) return undefined
    const nx = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1)
    const ny = Math.min(Math.max((event.clientY - rect.top) / rect.height, 0), 1)
    // Attested geometry wins; the band heuristic only covers a bridge whose
    // describe could not serve.
    const attested = screenRef.current
    if (attested !== undefined) {
      return { x: Math.round(nx * attested.widthPoints), y: Math.round(ny * attested.heightPoints) }
    }
    const renderScale = pxWidth / 3 >= 250 && pxWidth / 3 <= 520 ? 3 : pxWidth / 2 >= 500 && pxWidth / 2 <= 1100 ? 2 : 1
    return { x: Math.round(nx * (pxWidth / renderScale)), y: Math.round(ny * (pxHeight / renderScale)) }
  }

  /**
   * USB-HID keyboard usages (page 0x07) for the KeyboardEvent codes the
   * panel forwards. Shifted symbols ride the same usage plus the shift
   * flag; codes outside the map stay with the browser.
   */
  const HID_USAGE: Record<string, number> = {
    KeyA: 4, KeyB: 5, KeyC: 6, KeyD: 7, KeyE: 8, KeyF: 9, KeyG: 10, KeyH: 11, KeyI: 12,
    KeyJ: 13, KeyK: 14, KeyL: 15, KeyM: 16, KeyN: 17, KeyO: 18, KeyP: 19, KeyQ: 20,
    KeyR: 21, KeyS: 22, KeyT: 23, KeyU: 24, KeyV: 25, KeyW: 26, KeyX: 27, KeyY: 28, KeyZ: 29,
    Digit1: 30, Digit2: 31, Digit3: 32, Digit4: 33, Digit5: 34, Digit6: 35, Digit7: 36,
    Digit8: 37, Digit9: 38, Digit0: 39,
    Enter: 40, Escape: 41, Backspace: 42, Tab: 43, Space: 44,
    Minus: 45, Equal: 46, BracketLeft: 47, BracketRight: 48, Backslash: 49,
    Semicolon: 51, Quote: 52, Backquote: 53, Comma: 54, Period: 55, Slash: 56,
    Delete: 76, ArrowRight: 79, ArrowLeft: 80, ArrowDown: 81, ArrowUp: 82,
  }

  /** `event.key` fallbacks for dispatchers that omit the physical `code`. */
  const KEY_TO_CODE: Record<string, string> = {
    ' ': 'Space', Enter: 'Enter', Backspace: 'Backspace', Tab: 'Tab', Escape: 'Escape',
    Delete: 'Delete', ArrowRight: 'ArrowRight', ArrowLeft: 'ArrowLeft', ArrowDown: 'ArrowDown', ArrowUp: 'ArrowUp',
    '-': 'Minus', '=': 'Equal', '[': 'BracketLeft', ']': 'BracketRight', '\\': 'Backslash',
    ';': 'Semicolon', "'": 'Quote', '`': 'Backquote', ',': 'Comma', '.': 'Period', '/': 'Slash',
  }

  function onSurfaceKeyDown(event: React.KeyboardEvent): void {
    if (codecRef.current === undefined) return
    if (event.metaKey || event.ctrlKey || event.altKey) return
    // The physical code is authoritative; a dispatcher that omits it (an
    // automation bridge, some IMEs) still names the character in `key`.
    let code = event.code
    let shift = event.shiftKey
    if (code === '' || HID_USAGE[code] === undefined) {
      const key = event.key
      if (/^[a-zA-Z]$/.test(key)) {
        code = `Key${key.toUpperCase()}`
        shift = shift || key !== key.toLowerCase()
      } else if (/^[0-9]$/.test(key)) {
        code = `Digit${key}`
      } else {
        code = KEY_TO_CODE[key] ?? ''
      }
    }
    const usage = HID_USAGE[code]
    if (usage === undefined) return
    event.preventDefault()
    socketRef.current?.send(JSON.stringify({
      action: 'input',
      gesture: { type: 'key', usage, ...(shift ? { shift: true } : {}) },
    }))
  }

  function pressHardwareButton(name: string): void {
    socketRef.current?.send(JSON.stringify({ action: 'input', gesture: { type: 'button', name } }))
  }

  function onSurfacePointerDown(event: React.PointerEvent<HTMLVideoElement | HTMLCanvasElement>): void {
    if (codecRef.current === undefined) return
    const point = devicePointFrom(event, event.currentTarget)
    if (point === undefined) return
    event.currentTarget.setPointerCapture(event.pointerId)
    gestureRef.current = { clientX: event.clientX, clientY: event.clientY, startedAt: performance.now(), point }
  }

  function onSurfacePointerUp(event: React.PointerEvent<HTMLVideoElement | HTMLCanvasElement>): void {
    const began = gestureRef.current
    gestureRef.current = undefined
    if (began === undefined) return
    const endPoint = devicePointFrom(event, event.currentTarget)
    if (endPoint === undefined) return
    const cssDistance = Math.hypot(event.clientX - began.clientX, event.clientY - began.clientY)
    const gesture = cssDistance < SWIPE_MIN_CSS_PX
      ? { type: 'tap', x: began.point.x, y: began.point.y }
      : {
        type: 'swipe',
        xStart: began.point.x,
        yStart: began.point.y,
        xEnd: endPoint.x,
        yEnd: endPoint.y,
        durationMs: Math.round(Math.min(Math.max(performance.now() - began.startedAt, 60), 1500)),
      }
    socketRef.current?.send(JSON.stringify({ action: 'input', gesture }))
  }

  const streaming = codec !== undefined
  const connecting = status.key === 'status.connecting'
  const selected = devices.find(d => d.id === device)

  /** One device row of the picker: its runtime (and own name when renamed) plus the power state. */
  const deviceEntry = (d: DeviceRow, model: string): MenuEntry => ({
    id: d.id,
    label: (
      <span className={styles.menuName}>
        <span className={styles.menuNameText}>{deviceRowLabel(d, model)}</span>
        <span className={clsx(styles.menuState, d.state === 'booted' && styles.menuStateBooted)}>
          {t(d.state === 'booted' ? 'device.booted' : 'device.shutdownState')}
        </span>
      </span>
    ),
  })
  const pickerItems: MenuEntry[] = [
    { id: 'auto', label: t('picker.auto') },
    ...groupDevices(devices).flatMap(group => [
      { type: 'label' as const, id: `model-${group.key}`, text: group.model },
      ...group.devices.map(d => deviceEntry(d, group.model)),
    ]),
  ]
  const pickerFooter: MenuEntry[] = [
    ...(selected === undefined
      ? []
      : [{ id: selected.state === 'booted' ? 'power-shutdown' : 'power-boot', label: selected.state === 'booted' ? t('device.shutdown') : t('device.boot') }]),
    { id: 'create', label: t('device.create'), icon: <IconPlusOutline16 /> },
  ]
  const onPick = (id: string): void => {
    setPickerOpen(false)
    if (id === 'auto') { setDevice(undefined); return }
    if (id === 'create') { openCreate(); return }
    if (id === 'power-boot' && selected !== undefined) { bootDevice(selected.id); return }
    if (id === 'power-shutdown' && selected !== undefined) { shutdownDevice(selected.id); return }
    setDevice(id)
  }
  const chipState = streaming ? 'done' : selected?.state === 'booted' ? 'done' : undefined
  const readoutState = streaming ? 'done' : connecting ? 'ongoing' : error !== undefined ? 'error' : undefined

  const keycaps: { name: string; key: Parameters<typeof t>[0] }[] = [
    { name: 'lock', key: 'hw.lock' },
    { name: 'side_button', key: 'hw.side' },
    { name: 'siri', key: 'hw.siri' },
    { name: 'home', key: 'hw.home' },
  ]

  return (
    <div className={styles.panel}>
      <div className={styles.strip}>
        <Menu
          open={pickerOpen}
          portal
          dense
          items={pickerItems}
          footer={pickerFooter}
          selectedId={device ?? 'auto'}
          onSelect={onPick}
          onClose={() => { setPickerOpen(false) }}
          anchor={(
            <Button
              variant="outline"
              size="sm"
              className={styles.deviceChip}
              aria-label={t('picker.label')}
              aria-haspopup="menu"
              aria-expanded={pickerOpen}
              disabled={streaming}
              onClick={() => { setPickerOpen(open => !open) }}
            >
              {chipState !== undefined ? <StateDot state={chipState} size={8} /> : null}
              <span className={styles.deviceChipName}>{selected === undefined ? t('picker.auto') : deviceChipLabel(selected)}</span>
              <IconChevronDownOutline14 className={styles.deviceChipChevron} />
            </Button>
          )}
        />
        {streaming
          ? (
            <Button variant="outline" size="sm" className={styles.powerAction} icon={<IconStopFill16 />} onClick={stop}>
              {t('action.stop')}
            </Button>
          )
          : (
            <Button variant="primary" size="sm" className={styles.powerAction} icon={<IconPlayOutline16 />} onClick={start} disabled={connecting}>
              {t('action.start')}
            </Button>
          )}
        <span className={clsx(styles.readout, streaming && styles.readoutLive)} role="status" aria-live="polite">
          {readoutState !== undefined ? <StateDot state={readoutState} size={8} /> : null}
          <span>{t(status.key)}</span>
          {codec !== undefined ? <span className={styles.readoutCodec}>{codec}</span> : null}
        </span>
        <span className={styles.spacer} />
      </div>
      {creating && (
        <div className={styles.createCard} role="dialog" aria-label={t('create.title')}>
          <div className={styles.createTitle}>{t('create.title')}</div>
          <label className={styles.createField}>
            <span className={styles.createLabel}>{t('create.name')}</span>
            <Input
              className={styles.createInput ?? ''}
              autoFocus
              value={newName}
              onChange={(e) => { setNewName(e.target.value) }}
            />
          </label>
          <label className={styles.createField}>
            <span className={styles.createLabel}>{t('create.type')}</span>
            <select className={styles.select} value={newType} onChange={(e) => { setNewType(e.target.value) }}>
              {deviceTypes.length === 0 && <option value="">{t('create.loading')}</option>}
              {deviceTypes.map(dt => <option key={dt.identifier} value={dt.identifier}>{dt.name}</option>)}
            </select>
          </label>
          <label className={styles.createField}>
            <span className={styles.createLabel}>{t('create.runtime')}</span>
            <select className={styles.select} value={newRuntime} onChange={(e) => { setNewRuntime(e.target.value) }}>
              {runtimes.length === 0 && <option value="">{t('create.loading')}</option>}
              {runtimes.map(rt => <option key={rt.identifier} value={rt.identifier} disabled={!rt.available}>{rt.name}{rt.available ? '' : ` (${t('create.unavailable')})`}</option>)}
            </select>
          </label>
          <div className={styles.createActions}>
            <Button variant="ghost" size="sm" onClick={() => { setCreating(false) }}>{t('create.cancel')}</Button>
            <Button variant="primary" size="sm" onClick={submitCreate} disabled={newName.trim() === '' || newType === '' || newRuntime === ''}>{t('create.submit')}</Button>
          </div>
        </div>
      )}
      {autoTargetHint && !streaming && (
        <div className={styles.notice}>{t('note.noInventory')}</div>
      )}
      {error !== undefined && (
        <div className={clsx(styles.notice, styles.noticeError)} role="alert">
          <span className={styles.noticeIcon}><IconWarningOutline16 /></span>
          <span>{t(error.key)}{error.detail === undefined ? '' : `: ${error.detail}`}</span>
        </div>
      )}
      <div className={styles.stage}>
        <div className={styles.bench}>
          {codec !== undefined && codec !== 'mjpeg'
            ? (
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                tabIndex={0}
                className={styles.screen}
                onPointerDown={onSurfacePointerDown}
                onPointerUp={onSurfacePointerUp}
                onKeyDown={onSurfaceKeyDown}
              />
            )
            : (
              <canvas
                ref={canvasRef}
                tabIndex={0}
                className={clsx(styles.screen, !streaming && styles.hidden)}
                onPointerDown={onSurfacePointerDown}
                onPointerUp={onSurfacePointerUp}
                onKeyDown={onSurfaceKeyDown}
              />
            )}
          {!streaming && (
            <div className={styles.silhouette}>
              <div className={styles.silhouetteFrame}>
                {connecting ? <IconLoadingOutline16 className={styles.spin} /> : null}
              </div>
              <div className={styles.silhouetteText}>
                {connecting ? t('status.connecting') : status.key === 'status.stopped' ? t('status.stopped') : t('placeholder.start')}
              </div>
            </div>
          )}
        </div>
        <div className={styles.rail}>
          <div className={styles.keycaps} role="group" aria-label={t('hw.rail')}>
            {keycaps.map(cap => (
              <button
                key={cap.name}
                type="button"
                className={styles.keycap}
                disabled={!streaming}
                onClick={() => { pressHardwareButton(cap.name) }}
              >
                {t(cap.key)}
              </button>
            ))}
          </div>
          {streaming && <div className={styles.keyboardHint}>{t('hw.keyboardHint')}</div>}
        </div>
      </div>
    </div>
  )
}
