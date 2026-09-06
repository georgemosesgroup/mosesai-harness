/**
 * The helper session: launch one `iossim-helper` child through the subprocess
 * seam, prove it with its hello frame, demultiplex its stdout (control JSON
 * vs live video chunks), and serve control requests one at a time over the
 * framed protocol. Supervision — restarts, bounds, error classification —
 * lives with the provider; this module owns one live helper's lifetime and
 * wire discipline only.
 * @module @deepseek-ai/dsh-ios-sim-native/helper
 */

import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { SimulatorError, SIMULATOR_ERROR_CODES } from '@deepseek-ai/dsh-ios-sim'
import type { SimulatorErrorCode } from '@deepseek-ai/dsh-ios-sim'
import { HELPER_PROTOCOL_VERSION } from '@deepseek-ai/iossim-helper'
import { encodeFrame, FRAME_JSON, FRAME_VIDEO, rawFrames } from './protocol.ts'

/** One negotiated helper frame: the hello, a result, or a named error. */
interface ProtocolFrame {
  id?: unknown
  ok?: unknown
  result?: unknown
  helper?: unknown
  protocol?: unknown
  error?: { code?: unknown; message?: unknown }
}

/**
 * The child's settlement, normalized to a never-rejecting shape: a spawn-level
 * failure is as much an exit as a clean close, and callers classify by facts
 * instead of by catching.
 */
type Settlement = { kind: 'exit'; outcome: { exitCode: number | null; signal: NodeJS.Signals | null } } | { kind: 'error'; error: unknown }

/** One pending control request awaiting its response frame. */
interface RequestWaiter {
  resolve: (frame: ProtocolFrame) => void
  reject: (error: SimulatorError) => void
}

/**
 * Bounded live-chunk buffer, measured in bytes. Dropping chunks is NOT an
 * option for the fMP4 transports: the stream is one continuous byte sequence,
 * and losing any chunk tears it — the browser demuxer then reads mid-frame
 * bytes as a box header and kills the pipeline (observed as
 * CHUNK_DEMUXER_ERROR_APPEND_FAILED at a stable offset, because the encoder's
 * warm-up burst overflows a small queue deterministically). A lagging consumer
 * therefore fails the stream loudly instead of silently corrupting it.
 */
const MAX_VIDEO_QUEUE_BYTES = 64 * 1024 * 1024

/**
 * One live, handshake-proven helper child.
 */
export interface LiveHelper {
  /**
   * Run one control operation to completion. Responses are matched to
   * requests by frame id, so a concurrently flowing video stream cannot
   * interleave into the control path.
   * @param op - the operation name (`describe`, `input`, `stream-stop`).
   * @param params - the operation's parameters.
   * @returns the helper's result object.
   * @throws {SimulatorError} the frame's own seam code for substrate
   *   failures, `SIMULATOR_HELPER_UNAVAILABLE` when the child died in flight,
   *   or `SIMULATOR_HELPER_PROTOCOL_BROKEN` when framing breaks.
   */
  request(op: string, params: Record<string, unknown>): Promise<Record<string, unknown>>
  /**
   * Open the live video stream: the helper encodes the device framebuffer
   * through VideoToolbox and pushes type-1 binary chunks until `stop` or the
   * child dies.
   * @param params - the stream knobs (codec, frame rate, scale).
   * @returns the negotiated codec, the chunk iterator, and the stop closure.
   * @throws {SimulatorError} the same classification as {@link request}.
   */
  startVideoStream(params: Record<string, unknown>): Promise<{
    codec: string
    chunks: AsyncIterable<Uint8Array>
    stop(): Promise<void>
  }>
  /**
   * Close stdin gracefully — the protocol's EOF-means-done — and wait for a
   * clean exit, terminating the tree only if the child ignores the close.
   * The normal shutdown path.
   */
  close(): Promise<void>
}

/** Constructor dependencies of {@link startHelper}, all injection-owned. */
export interface HelperStartOptions {
  /** Absolute helper path to spawn (the entry package's resolution or an explicit override). */
  readonly path: string
  /** The subprocess seam used for every spawn. */
  readonly spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle
  /** Working directory for the helper child. */
  readonly cwd: string
  /** SIGTERM→SIGKILL escalation grace for teardown. */
  readonly graceMs: number
}

/**
 * Launch one helper and wait for its hello frame — the launch proof. Every
 * failure here says THIS binary attempt is unusable; the provider decides
 * whether that means a supervised restart or a named failure.
 * @param options - the spawn plan.
 * @returns the live helper session.
 * @throws {SimulatorError} code `SIMULATOR_HELPER_UNAVAILABLE` when the
 *   binary cannot spawn at all, or `SIMULATOR_HELPER_PROTOCOL_BROKEN` when it
 *   exits or announces anything but the expected hello.
 */
export async function startHelper(options: HelperStartOptions): Promise<LiveHelper> {
  let stderrTail = ''
  let handle: SubprocessHandle
  try {
    handle = options.spawn({
      argv: [options.path],
      cwd: options.cwd,
      stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
      graceMs: options.graceMs,
    })
  } catch (cause) {
    throw new SimulatorError(
      `the iossim-helper binary at "${options.path}" could not be launched: ${String(cause)}. `
        + 'Mount dsh-ios-sim-native on a host with the helper installed (the @deepseek-ai/iossim-helper platform package), '
        + 'or point the provider config at an explicit helperPath.',
      'SIMULATOR_HELPER_UNAVAILABLE',
      { cause },
    )
  }
  /* v8 ignore start -- all three pipes are requested by construction; defensive. */
  if (handle.stdin === undefined || handle.stdout === undefined || handle.stderr === undefined) {
    throw new SimulatorError('ios-sim-native: subprocess implementation dropped a requested pipe stream', 'SIMULATOR_HELPER_UNAVAILABLE')
  }
  /* v8 ignore stop */
  const stdin = handle.stdin
  handle.stderr.on('data', (chunk: Buffer) => {
    stderrTail = `${stderrTail}${chunk.toString('utf8')}`.slice(-400)
  })
  // A child that dies mid-request makes later stdin writes fail with EPIPE;
  // the supervision layer owns that classification, not the stream event.
  /* v8 ignore next -- contains an EPIPE that only fires when child death races a write. */
  stdin.on('error', () => {})

  const settled: Promise<Settlement> = handle.done.then(
    outcome => ({ kind: 'exit', outcome }),
    (error: unknown) => ({ kind: 'error', error }),
  )
  const exited = settled.then(() => true)

  // The demultiplexer: control JSON goes to the waiter table, video chunks to
  // the active stream sink. The hello is read BEFORE the loop starts, so it
  // can never be mistaken for a request response.
  const waiters = new Map<number, RequestWaiter>()
  let videoSink: ((chunk: Uint8Array) => void) | undefined
  let videoClosed = false
  let dispatchBroken: SimulatorError | undefined
  let dispatchEnded = false

  function deadHelper(what: string): SimulatorError {
    return new SimulatorError(
      `the iossim-helper binary at "${options.path}" ${what}`
        + (stderrTail.trim().length > 0 ? `: ${stderrTail.trim()}` : ''),
      'SIMULATOR_HELPER_UNAVAILABLE',
    )
  }
  async function settleAllOnExit(): Promise<void> {
    // stdout closed: a child that also exited is a dead helper; one that
    // keeps running with a closed stdout broke framing. The exit facts
    // settle microseconds after the pipe closes, so the classification
    // waits briefly for them.
    const hasExit = await Promise.race([
      exited,
      new Promise<false>((resolve) => {
        setTimeout(() => {
          resolve(false)
        }, 100)
      }),
    ])
    const error = hasExit
      ? await classifyExit('while a request was in flight')
      : new SimulatorError(
        `the iossim-helper binary at "${options.path}" closed stdout while still running; framing is broken`,
        'SIMULATOR_HELPER_PROTOCOL_BROKEN',
      )
    for (const waiter of waiters.values()) {
      waiter.reject(error)
    }
    waiters.clear()
    videoClosed = true
  }
  async function classifyExit(what: string): Promise<SimulatorError> {
    const settlement = await settled
    if (settlement.kind === 'exit') {
      return new SimulatorError(
        `the iossim-helper binary at "${options.path}" ${what} (exit ${settlement.outcome.exitCode}, signal ${settlement.outcome.signal})`
          + (stderrTail.trim().length > 0 ? `: ${stderrTail.trim()}` : ''),
        'SIMULATOR_HELPER_UNAVAILABLE',
      )
    }
    return new SimulatorError(
      `the iossim-helper binary at "${options.path}" failed to spawn: ${String(settlement.error)}`,
      'SIMULATOR_HELPER_UNAVAILABLE',
      { cause: settlement.error },
    )
  }

  // ONE shared stdout iterator: the hello read consumes the first frame from
  // it, and the dispatch loop continues from the same buffered position. A
  // second iterator would race this one for stream chunks and split frames.
  const incoming = rawFrames(handle.stdout)

  async function dispatchLoop(): Promise<void> {
    try {
      for await (const frame of incoming) {
        if (frame.type === FRAME_VIDEO) {
          videoSink?.(frame.payload)
          continue
        }
        if (frame.type !== FRAME_JSON) continue
        const json = JSON.parse(frame.payload.toString('utf8')) as ProtocolFrame
        if (typeof json.id !== 'number') continue
        const waiter = waiters.get(json.id)
        if (waiter === undefined) {
          const breach = new SimulatorError(
            `the helper answered frame ${String(json.id)} with no matching in-flight request; framing is broken`,
            'SIMULATOR_HELPER_PROTOCOL_BROKEN',
          )
          for (const w of waiters.values()) w.reject(breach)
          waiters.clear()
          continue
        }
        waiters.delete(json.id)
        waiter.resolve(json)
      }
    } catch (cause) {
      dispatchBroken = new SimulatorError(
        `the iossim-helper binary at "${options.path}" broke stream framing: ${String(cause)}`,
        'SIMULATOR_HELPER_PROTOCOL_BROKEN',
      )
    }
    dispatchEnded = true
    await settleAllOnExit()
  }

  function parseProtocolFrame(payload: Buffer): ProtocolFrame {
    return JSON.parse(payload.toString('utf8')) as ProtocolFrame
  }

  // The hello is the launch proof: read it synchronously before any request
  // can be written.
  let hello: ProtocolFrame | undefined
  try {
    const first = await incoming.next()
    if (!first.done) hello = parseProtocolFrame(first.value.payload)
  } catch (cause) {
    throw new SimulatorError(
      `the iossim-helper binary at "${options.path}" broke stream framing before its hello: ${String(cause)}`,
      'SIMULATOR_HELPER_PROTOCOL_BROKEN',
      { cause },
    )
  }
  if (hello === undefined) {
    // stdout closed before the hello: classify by whether the child also
    // exited (a dead binary) or is still running (a framing breach).
    const hasExit = await Promise.race([
      exited,
      new Promise<false>((resolve) => {
        setTimeout(() => {
          resolve(false)
        }, 100)
      }),
    ])
    if (!hasExit) {
      throw new SimulatorError(
        `the iossim-helper binary at "${options.path}" closed stdout before its hello frame while still running; framing is broken`,
        'SIMULATOR_HELPER_PROTOCOL_BROKEN',
      )
    }
    const settlement = await settled
    if (settlement.kind === 'exit') {
      throw new SimulatorError(
        `the iossim-helper binary at "${options.path}" exited before its hello frame (exit ${settlement.outcome.exitCode}, signal ${settlement.outcome.signal})`
          + (stderrTail.trim().length > 0 ? `: ${stderrTail.trim()}` : ''),
        'SIMULATOR_HELPER_UNAVAILABLE',
      )
    }
    throw new SimulatorError(
      `the iossim-helper binary at "${options.path}" failed to spawn: ${String(settlement.error)}`,
      'SIMULATOR_HELPER_UNAVAILABLE',
      { cause: settlement.error },
    )
  }
  if (hello.helper !== 'iossim-helper' || hello.protocol !== HELPER_PROTOCOL_VERSION) {
    handle.terminate()
    await handle.waitForExit()
    throw new SimulatorError(
      `the iossim-helper binary at "${options.path}" announced ${JSON.stringify(hello)}, not a protocol-${HELPER_PROTOCOL_VERSION} hello; `
        + 'the binary and the @deepseek-ai/iossim-helper entry package version together, so this is a mixed install',
      'SIMULATOR_HELPER_PROTOCOL_BROKEN',
    )
  }

  // With the hello proven, the demultiplexer owns stdout for the rest of the
  // child's lifetime.
  void dispatchLoop()

  let sequence = 0

  async function sendRequest(op: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (dispatchEnded) {
      throw deadHelper('exited before the request was sent')
    }
    if (dispatchBroken !== undefined) throw dispatchBroken
    sequence += 1
    const id = sequence
    const received = new Promise<ProtocolFrame>((resolve, reject) => {
      waiters.set(id, { resolve, reject })
    })
    stdin.write(encodeFrame({ id, op, params }))
    const response = await received
    if (response.ok === true) {
      return response.result as Record<string, unknown>
    }
    const code = response.error?.code
    const message = response.error?.message
    const isSeamCode = typeof code === 'string' && SIMULATOR_ERROR_CODES.has(code as SimulatorErrorCode)
    // A seam code crosses verbatim; a foreign code is preserved in the
    // message and named under the provider's own failure class.
    const text = typeof message === 'string'
      ? (isSeamCode ? message : `${String(code)}: ${message}`)
      : JSON.stringify(response.error)
    throw new SimulatorError(
      `iossim-helper ${op} failed: ${text}`,
      isSeamCode ? code : 'SIMULATOR_HELPER_REQUEST_FAILED',
    )
  }

  return {
    request: sendRequest,
    async startVideoStream(params) {
      if (dispatchEnded) {
        throw deadHelper('exited before the stream started')
      }
      if (dispatchBroken !== undefined) throw dispatchBroken
      // The sink is registered before the request: video chunks may begin
      // flowing the moment the substrate starts encoding. The queue is
      // byte-bounded; overflow closes the stream instead of dropping chunks,
      // because the fMP4 transports cannot survive a torn byte sequence.
      const chunks: Uint8Array[] = []
      let queuedBytes = 0
      let closed = false
      let waiter: ((result: IteratorResult<Uint8Array>) => void) | undefined
      const closeSink = (): void => {
        closed = true
        const w = waiter
        waiter = undefined
        w?.({ value: undefined, done: true })
      }
      videoSink = (chunk) => {
        if (closed) return
        if (queuedBytes + chunk.byteLength > MAX_VIDEO_QUEUE_BYTES) {
          closeSink()
          return
        }
        queuedBytes += chunk.byteLength
        chunks.push(chunk)
        const w = waiter
        if (w !== undefined) {
          waiter = undefined
          const nextChunk = chunks.shift()
          if (nextChunk === undefined) throw new Error('the video queue emptied between guards')
          queuedBytes -= nextChunk.byteLength
          w({ value: nextChunk, done: false })
        }
      }
      const result = await sendRequest('stream-start', params)
      const codec = typeof result.codec === 'string' ? result.codec : 'h264'
      const iterate = async function* (): AsyncIterable<Uint8Array> {
        for (;;) {
          if (chunks.length > 0) {
            const head = chunks.shift() as Uint8Array
            queuedBytes -= head.byteLength
            yield head
            continue
          }
          if (videoClosed) return
          const next = await new Promise<IteratorResult<Uint8Array>>((resolve) => {
            waiter = resolve
          })
          if (next.done) return
          yield next.value
        }
      }
      return {
        codec,
        chunks: iterate(),
        stop: async () => {
          try {
            await sendRequest('stream-stop', {})
          } finally {
            closeSink()
          }
        },
      }
    },
    async close(): Promise<void> {
      stdin.end()
      const clean = await Promise.race([
        exited,
        new Promise<false>((resolve) => {
          setTimeout(() => {
            resolve(false)
          }, 2_000)
        }),
      ])
      if (!clean) {
        handle.terminate()
        await handle.waitForExit()
      }
    },
  }
}
