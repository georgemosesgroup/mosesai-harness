/**
 * The helper session: launch one `iossim-helper` child through the subprocess
 * seam, prove it with its hello frame, and serve one request at a time over
 * the framed protocol. Supervision — restarts, bounds, error classification —
 * lives with the provider; this module owns one live helper's lifetime and
 * wire discipline only.
 * @module @deepseek-ai/dsh-ios-sim-native/helper
 */

import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { SimulatorError, SIMULATOR_ERROR_CODES } from '@deepseek-ai/dsh-ios-sim'
import type { SimulatorErrorCode } from '@deepseek-ai/dsh-ios-sim'
import { HELPER_PROTOCOL_VERSION } from '@deepseek-ai/iossim-helper'
import { encodeFrame, frames } from './protocol.ts'

/** The hello frame's shape; any deviation is a broken helper, not a request failure. */
interface HelloFrame {
  helper?: unknown
  protocol?: unknown
}

/** One negotiated helper frame: a result or a named error. */
interface ProtocolFrame {
  id?: unknown
  ok?: unknown
  result?: unknown
  error?: { code?: unknown; message?: unknown }
}

/**
 * The child's settlement, normalized to a never-rejecting shape: a spawn-level
 * failure is as much an exit as a clean close, and callers classify by facts
 * instead of by catching.
 */
type Settlement = { kind: 'exit'; outcome: { exitCode: number | null; signal: NodeJS.Signals | null } } | { kind: 'error'; error: unknown }

/**
 * One live, handshake-proven helper child.
 */
export interface LiveHelper {
  /**
   * Run one operation to completion. The helper serves requests serially, so
   * callers serialize; the returned object is the response frame's `result`.
   * @param op - the operation name (`describe` today).
   * @param params - the operation's parameters.
   * @returns the helper's result object.
   * @throws {SimulatorError} the frame's own seam code for substrate
   *   failures, `SIMULATOR_HELPER_UNAVAILABLE` when the child died in flight,
   *   or `SIMULATOR_HELPER_PROTOCOL_BROKEN` when framing breaks.
   */
  request(op: string, params: Record<string, unknown>): Promise<Record<string, unknown>>
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
  /* v8 ignore next -- contains an EPIPE that only fires when child death races a write; timing tests cannot order deterministically. */
  stdin.on('error', () => {})

  const settled: Promise<Settlement> = handle.done.then(
    outcome => ({ kind: 'exit', outcome }),
    (error: unknown) => ({ kind: 'error', error }),
  )
  const exited = settled.then(() => true)
  const exitedOrUndefined = settled.then(() => undefined)

  // The frames() iterator consumes stdout exclusively; requests are written
  // one at a time and answered in order (the helper serves serially).
  const incoming = frames(handle.stdout)

  async function readNext(): Promise<ProtocolFrame | undefined> {
    const { value, done } = await incoming.next()
    return done ? undefined : value as ProtocolFrame
  }

  /**
   * Classify stdout EOF: a child that exited (any exit code, any signal, a
   * spawn-level failure) is UNAVAILABLE — this binary attempt is dead; a
   * still-running child whose stdout closed is a framing breach. The exit
   * facts settle microseconds after the pipe closes, so the classification
   * waits briefly for them.
   */
  async function classifyEof(what: string): Promise<SimulatorError> {
    const hasExit = await Promise.race([
      exited,
      new Promise<false>((resolve) => {
        setTimeout(() => {
          resolve(false)
        }, 100)
      }),
    ])
    if (!hasExit) {
      return new SimulatorError(
        `the iossim-helper binary at "${options.path}" closed stdout ${what} while still running; framing is broken`,
        'SIMULATOR_HELPER_PROTOCOL_BROKEN',
      )
    }
    const settlement = await settled
    const facts = settlement.kind === 'exit'
      ? `exit ${settlement.outcome.exitCode}, signal ${settlement.outcome.signal}`
      : `spawn failure: ${String(settlement.error)}`
    return new SimulatorError(
      `the iossim-helper binary at "${options.path}" ${what} (${facts})`
        + (stderrTail.trim().length > 0 ? `: ${stderrTail.trim()}` : ''),
      'SIMULATOR_HELPER_UNAVAILABLE',
    )
  }

  const hello = await Promise.race([readNext(), exitedOrUndefined])
  if (hello === undefined) {
    throw await classifyEof('before its hello frame')
  }
  const announced = hello as HelloFrame
  if (announced.helper !== 'iossim-helper' || announced.protocol !== HELPER_PROTOCOL_VERSION) {
    await kill(handle)
    throw new SimulatorError(
      `the iossim-helper binary at "${options.path}" announced ${JSON.stringify(hello)}, not a protocol-${HELPER_PROTOCOL_VERSION} hello; `
        + 'the binary and the @deepseek-ai/iossim-helper entry package version together, so this is a mixed install',
      'SIMULATOR_HELPER_PROTOCOL_BROKEN',
    )
  }

  let sequence = 0

  return {
    async request(op, params) {
      sequence += 1
      const id = sequence
      stdin.write(encodeFrame({ id, op, params }))
      for (;;) {
        const response = await Promise.race([readNext(), exitedOrUndefined])
        if (response === undefined) {
          throw await classifyEof(`with request ${id} in flight`)
        }
        if (response.id !== id) {
          throw new SimulatorError(
            `the helper answered frame ${String(response.id)} while request ${id} was in flight; framing is broken`,
            'SIMULATOR_HELPER_PROTOCOL_BROKEN',
          )
        }
        if (response.ok === true) {
          return response.result as Record<string, unknown>
        }
        const code = response.error?.code
        const message = response.error?.message
        const seamCode = SIMULATOR_ERROR_CODES.has(code as SimulatorErrorCode) ? code as SimulatorErrorCode : undefined
        // A seam code crosses verbatim; a foreign code is preserved in the
        // message and named under the provider's own failure class.
        const text = typeof message === 'string'
          ? (seamCode !== undefined ? message : `${String(code)}: ${message}`)
          : JSON.stringify(response.error)
        throw new SimulatorError(
          `iossim-helper ${op} failed: ${text}`,
          seamCode ?? 'SIMULATOR_HELPER_REQUEST_FAILED',
        )
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
      if (!clean) await kill(handle)
    },
  }
}

/** Terminate one child and wait for the whole process tree to reach quiescence. */
async function kill(handle: SubprocessHandle): Promise<void> {
  handle.terminate()
  await handle.waitForExit()
}
