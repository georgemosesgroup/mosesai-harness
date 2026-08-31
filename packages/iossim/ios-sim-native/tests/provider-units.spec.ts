/**
 * Units of the native provider against REAL stub-helper processes spawned
 * through the real local subprocess implementation: the framed protocol round
 * trip, the helper→seam describe mapping with its reference derivation, the
 * capability gate, supervision (recovery after a mid-request death, the named
 * exhaustion code), deadline breach with its stuck-child kill, and teardown
 * reaching the child. The assembled-composition transcript coverage lives in
 * the headless-agent snapshot; the live substrate is not involved anywhere.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { SimulatorError, SimulatorId, unadvertisedCapabilities } from '@deepseek-ai/dsh-ios-sim'
import { afterEach, describe, expect, it, vi } from 'vitest'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { NativeSimulatorProvider } from '../src/index.ts'
import { IosSimulator } from '@deepseek-ai/dsh-ios-sim'
import { describeResultFromHelper } from '../src/describe.ts'
import { encodeFrame, encodeTyped, FRAME_JSON, FRAME_VIDEO, MAX_FRAME_BYTES, rawFrames } from '../src/protocol.ts'
import { PassThrough, Readable } from 'node:stream'
import { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type { SubprocessHandle, SubprocessTerminalHandle } from '@deepseek-ai/dsh-subprocess'
import type { SimulatorCapability } from '@deepseek-ai/dsh-ios-sim'

/**
 * A subprocess service whose spawn throws synchronously (the launch-failure
 * path startHelper must wrap) or hands back a handle whose done rejects
 * (a spawn-level failure after a handle exists), per the seam's stub pattern.
 */
class ThrowingSubprocess extends SubprocessRuntime {
  override async resolveExecutable(command: string): Promise<string> {
    return command
  }

  spawn(): SubprocessHandle {
    throw 'spawn refused by the test seam'
  }

  spawnTerminal(): Promise<SubprocessTerminalHandle> {
    throw new Error('unused in this suite')
  }
}

class RejectingDoneSubprocess extends SubprocessRuntime {
  override async resolveExecutable(command: string): Promise<string> {
    return command
  }

  spawn(): SubprocessHandle {
    const stdout = new Readable({ read() { this.push(null) } })
    const stderr = new Readable({ read() { this.push(null) } })
    return {
      pid: 1,
      stdin: new PassThrough(),
      stdout,
      stderr,
      collected: {},
      done: Promise.reject(new Error('spawn-level failure injected')),
      terminate: () => {},
      waitForExit: () => Promise.resolve(true),
    }
  }

  spawnTerminal(): Promise<SubprocessTerminalHandle> {
    throw new Error('unused in this suite')
  }
}

const fixture = (name: string): string => join(fileURLToPath(new URL('./fixtures', import.meta.url)), name)

interface Mounted {
  ctx: Context
  provider: NativeSimulatorProvider
  marker: string
  /** Disposes ONLY the provider's plugin fiber: its own teardown effect runs, the subprocess service stays. */
  disposeProvider: () => Promise<void>
  dispose: () => Promise<void>
}

/**
 * Mount the real provider over one stub-helper fixture the way the Loader
 * would (plugin + schemastery Config), with a scratch marker file the stub
 * appends lifecycle facts to.
 */
type ProviderConfig = {
  helperPath?: string
  timeoutMs?: number
  maxTimeoutMs?: number
  maxRestarts?: number
  graceMs?: number
}

// Mounts the real provider over one stub-helper fixture the way the Loader
// would (plugin + schemastery Config), with a scratch marker file the stub
// appends lifecycle facts to.
async function mountedProvider(config: ProviderConfig): Promise<Mounted> {
  const ctx = new Context()
  await ctx.plugin(LocalSubprocessRuntime)
  const marker = join(mkdtempSync(join(tmpdir(), 'iossim-native-spec-')), 'marker.log')
  process.env.STUB_MARKER = marker
  const providerFiber = await ctx.plugin(NativeSimulatorProvider, config)
  return {
    ctx,
    provider: ctx.iosSimulator as NativeSimulatorProvider,
    marker,
    disposeProvider: () => providerFiber.dispose(),
    dispose: () => ctx.fiber.dispose(),
  }
}

const mounted: Mounted[] = []
afterEach(async () => {
  await Promise.all(mounted.splice(0).map(entry => entry.dispose()))
})

describe('describe result mapping', () => {
  it('maps the helper payload onto the seam type and derives index-path references', () => {
    const result = describeResultFromHelper({
      simulatorId: 'STUB-A',
      truncated: false,
      root: {
        identifier: 'com.fixture.app',
        type: 'Application',
        label: 'FixtureApp',
        frame: { x: 0, y: 0, width: 393, height: 852 },
        enabled: true,
        children: [
          { type: 'Button', label: 'Continue', frame: { x: 20, y: 100, width: 200, height: 44 }, enabled: true, children: [] },
          { identifier: 'email', type: 'TextField', label: null, frame: { x: 20, y: 200, width: 353, height: 40 }, enabled: false },
        ],
      },
      screen: { width: 393, height: 852 },
    })
    expect(result.simulatorId).toBe(SimulatorId('STUB-A'))
    expect(result.screen).toEqual({ widthPoints: 393, heightPoints: 852 })
    expect(result.truncated).toBe(false)
    const root = result.root
    expect(root).not.toBeNull()
    if (root === null) throw new Error('unreachable')
    expect(root.reference).toBe('0')
    expect(root.role).toBe('Application')
    expect(root.frame).toEqual({ xPoints: 0, yPoints: 0, widthPoints: 393, heightPoints: 852 })
    const [button, field] = root.children
    expect(button?.reference).toBe('0.0')
    expect(button?.label).toBe('Continue')
    expect(field?.reference).toBe('0.1')
    // A null label and a null-enabled attest nothing: label stays absent,
    // enabled maps to the conservative false.
    expect(field?.label).toBeUndefined()
    expect(field?.enabled).toBe(false)
  })

  it('maps an empty read to a null root and an unattested screen to absence', () => {
    const result = describeResultFromHelper({ simulatorId: 'STUB-A', truncated: true, root: null })
    expect(result.root).toBeNull()
    expect(result.screen).toBeUndefined()
    expect(result.truncated).toBe(true)
  })

  it('drops attributes the substrate did not attest instead of guessing them', () => {
    const result = describeResultFromHelper({
      simulatorId: 'STUB-A',
      truncated: false,
      // A null child is skipped; a frame with a non-finite edge attests
      // nothing; a non-numeric screen size attests no geometry.
      root: { enabled: false, children: 'not-an-array' as unknown as unknown[], frame: { x: 0, y: 0 } },
      screen: { width: Number.NaN, height: 852 },
    })
    const root = result.root
    if (root === null) throw new Error('unreachable')
    // A frame with a non-finite edge attests nothing, and an element the
    // substrate types by nothing maps to the Unknown role.
    expect(root.frame).toBeUndefined()
    expect(root.role).toBe('Unknown')
    expect(root.children).toEqual([])
    expect(result.screen).toBeUndefined()

    const partial = describeResultFromHelper({
      simulatorId: 'STUB-A',
      truncated: false,
      root: { type: 'Window', enabled: true, frame: { x: 0, y: 0, width: 'wide', height: 852 }, children: [null, { type: 'Button', enabled: true, children: [] }] },
    })
    const partialRoot = partial.root
    if (partialRoot === null) throw new Error('unreachable')
    expect(partialRoot.frame).toBeUndefined()
    // A null child is skipped and the surviving child's reference stays compact.
    expect(partialRoot.children).toEqual([expect.objectContaining({ reference: '0.0', role: 'Button' })])
  })

  it('rejects payloads outside the documented shape as protocol breaches, not caller errors', () => {
    expect(() => describeResultFromHelper({ truncated: false, root: null }))
      .toThrow(SimulatorError)
    expect(() => describeResultFromHelper({ simulatorId: 'S', root: null }))
      .toThrow(/truncated/)
    expect(() => describeResultFromHelper({ simulatorId: 'S', truncated: false, root: 'not-an-object' }))
      .toThrow(/not an object/)
    try {
      describeResultFromHelper({ simulatorId: 'S', truncated: false, root: null })
    } catch (error) {
      expect((error as SimulatorError).code).toBe('SIMULATOR_HELPER_PROTOCOL_BROKEN')
    }
  })
})

describe('frame protocol', () => {
  it('round-trips frames through encode and the stream reader, demultiplexing by type', async () => {
    const payload = { id: 3, ok: true, result: { a: 1 } }
    const video = Buffer.from([1, 2, 3, 4])
    const stream = Readable.from([
      encodeFrame(payload),
      encodeTyped(FRAME_VIDEO, video),
      encodeFrame({ id: 4, ok: false }),
    ])
    const seen: Array<{ type: number; payload: Buffer }> = []
    for await (const frame of rawFrames(stream)) seen.push(frame)
    expect(seen).toHaveLength(3)
    expect(seen[0]?.type).toBe(FRAME_JSON)
    expect(JSON.parse(seen[0]?.payload.toString('utf8') as string)).toEqual(payload)
    expect(seen[1]?.type).toBe(FRAME_VIDEO)
    const videoPayload = seen[1]?.payload
    expect(videoPayload ? [...videoPayload.values()] : []).toEqual([1, 2, 3, 4])
    expect(seen[2]?.type).toBe(FRAME_JSON)
  })

  it('refuses oversized lengths and trailing bytes as framing breaches', async () => {
    const oversized = Buffer.alloc(4)
    oversized.writeUInt32BE(MAX_FRAME_BYTES + 1, 0)
    await expect(async () => {
      for await (const _ of rawFrames(Readable.from([oversized]))) {
        // The generator throws on the length check before yielding.
      }
    }).rejects.toThrow(/byte bound/)

    const trailing = Buffer.concat([encodeFrame({ id: 1 }), Buffer.from('ab')])
    await expect(async () => {
      for await (const _ of rawFrames(Readable.from([trailing]))) {
        // Trailing bytes shorter than a length prefix throw at clean EOF.
      }
    }).rejects.toThrow(/trailing bytes/)

    // A zero-length frame is outside the 1.. bound, and a header claiming
    // more body than the stream carries is the trailing-bytes breach.
    const zero = Buffer.alloc(4)
    await expect(async () => {
      for await (const _ of rawFrames(Readable.from([zero]))) {}
    }).rejects.toThrow(/byte bound/)
    const short = Buffer.concat([Buffer.from([0, 0, 0, 10]), Buffer.from('abc')])
    await expect(async () => {
      for await (const _ of rawFrames(Readable.from([short]))) {}
    }).rejects.toThrow(/trailing bytes/)
  })
})

describe('the native provider over real stub helpers', () => {
  it('serves describe end to end and passes the target reference through', async () => {
    const suite = await mountedProvider({ helperPath: fixture('good-helper.mjs') })
    mounted.push(suite)
    const result = await suite.provider.describe({})
    expect(result.simulatorId).toBe(SimulatorId('STUB-A'))
    expect(result.root?.reference).toBe('0')

    const named = await suite.provider.describe({ simulator: SimulatorId('STUB-EXPLICIT') })
    expect(named.simulatorId).toBe(SimulatorId('STUB-EXPLICIT'))
  })

  it('declares describe and input, proves advertisement↔hook consistency, and gates the rest loud', async () => {
    const suite = await mountedProvider({ helperPath: fixture('good-helper.mjs') })
    mounted.push(suite)
    expect([...suite.provider.capabilities]).toEqual(['describe', 'input', 'stream'])
    expect(unadvertisedCapabilities(suite.provider)).toEqual([])
    for (const verb of [
      suite.provider.list(),
      suite.provider.boot({ simulator: SimulatorId('X') }),
    ]) {
      const error = await verb.catch((cause: unknown) => cause)
      expect(error).toBeInstanceOf(SimulatorError)
      expect((error as SimulatorError).code).toBe('SIMULATOR_CAPABILITY_UNAVAILABLE')
      expect((error as SimulatorError).message).toContain('@deepseek-ai/dsh-ios-sim-native')
    }
  })

  it('recovers a request after the helper dies mid-call', async () => {
    const suite = await mountedProvider({ helperPath: fixture('flaky-helper.mjs') })
    mounted.push(suite)
    const result = await suite.provider.describe({})
    expect(result.simulatorId).toBe(SimulatorId('STUB-A'))
    expect(readFileSync(suite.marker, 'utf8')).toContain('died-on-first')
  }, 30_000)

  it('names the failure once the supervised restart bound is exhausted', async () => {
    const suite = await mountedProvider({ helperPath: fixture('always-dies-helper.mjs'), maxRestarts: 1 })
    mounted.push(suite)
    const error = await suite.provider.describe({}).catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(SimulatorError)
    expect((error as SimulatorError).code).toBe('SIMULATOR_HELPER_SUPERVISION_EXHAUSTED')
    expect((error as SimulatorError).message).toContain('restart bound of 1')
  }, 30_000)

  it('refuses a helper that never announces the expected hello', async () => {
    for (const [file, code] of [
      ['no-hello-helper.mjs', 'SIMULATOR_HELPER_UNAVAILABLE'],
      ['wrong-protocol-helper.mjs', 'SIMULATOR_HELPER_PROTOCOL_BROKEN'],
    ] as const) {
      const suite = await mountedProvider({ helperPath: fixture(file), maxRestarts: 1 })
      mounted.push(suite)
      const error = await suite.provider.describe({}).catch((cause: unknown) => cause)
      expect(error).toBeInstanceOf(SimulatorError)
      expect((error as SimulatorError).code).toBe(code)
    }
  }, 30_000)

  it('breaches the deadline, kills the stuck child, and surfaces the timeout code', async () => {
    const suite = await mountedProvider({ helperPath: fixture('slow-helper.mjs'), timeoutMs: 300, maxTimeoutMs: 30_000 })
    mounted.push(suite)
    const error = await suite.provider.describe({}).catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(SimulatorError)
    expect((error as SimulatorError).code).toBe('SIMULATOR_HELPER_TIMEOUT')
    // The deadline kill reaches the child, which reports the SIGTERM.
    expect(readFileSync(suite.marker, 'utf8')).toContain('terminated')
  }, 30_000)

  it('serializes concurrent requests through the one-at-a-time helper', async () => {
    const suite = await mountedProvider({ helperPath: fixture('good-helper.mjs') })
    mounted.push(suite)
    const [first, second] = await Promise.all([
      suite.provider.describe({}),
      suite.provider.describe({ simulator: SimulatorId('STUB-B') }),
    ])
    expect(first.simulatorId).toBe(SimulatorId('STUB-A'))
    expect(second.simulatorId).toBe(SimulatorId('STUB-B'))
  }, 30_000)

  it('serves input: an element reference resolves to its cached frame centre', async () => {
    const suite = await mountedProvider({ helperPath: fixture('good-helper.mjs') })
    mounted.push(suite)
    await suite.provider.describe({})
    const result = await suite.provider.input({
      action: { kind: 'tap', target: { kind: 'element', reference: '0.0' } },
    })
    // The Continue button's frame is x20 y100 200x44: its centre is 120,122.
    expect(result.simulatorId).toBe(SimulatorId('STUB-A'))
    expect(result.actedAt).toEqual({ xPoints: 120, yPoints: 122 })
  }, 30_000)

  it('serves input by coordinate point without consulting the reference cache', async () => {
    const suite = await mountedProvider({ helperPath: fixture('good-helper.mjs') })
    mounted.push(suite)
    const result = await suite.provider.input({
      action: { kind: 'tap', target: { kind: 'point', at: { xPoints: 55, yPoints: 66 } } },
    })
    expect(result.actedAt).toEqual({ xPoints: 55, yPoints: 66 })
  }, 30_000)

  it('rejects an element reference with no cached describe as stale, naming the repair', async () => {
    const suite = await mountedProvider({ helperPath: fixture('good-helper.mjs') })
    mounted.push(suite)
    const error = await suite.provider.input({
      action: { kind: 'tap', target: { kind: 'element', reference: '0.0' } },
    }).catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(SimulatorError)
    expect((error as SimulatorError).code).toBe('SIMULATOR_ELEMENT_REFERENCE_STALE')
    expect((error as SimulatorError).message).toContain('no describe has been served yet')
  }, 30_000)

  it('rejects a reference minted for another device as stale', async () => {
    const suite = await mountedProvider({ helperPath: fixture('good-helper.mjs') })
    mounted.push(suite)
    await suite.provider.describe({})
    const error = await suite.provider.input({
      simulator: SimulatorId('OTHER-DEVICE'),
      action: { kind: 'tap', target: { kind: 'element', reference: '0.0' } },
    }).catch((cause: unknown) => cause)
    expect((error as SimulatorError).code).toBe('SIMULATOR_ELEMENT_REFERENCE_STALE')
    expect((error as SimulatorError).message).toContain('the cached describe served device "STUB-A"')
  }, 30_000)

  it('serves swipe, key, and text gestures and reports the landing point', async () => {
    const suite = await mountedProvider({ helperPath: fixture('good-helper.mjs') })
    mounted.push(suite)
    const swipe = await suite.provider.input({
      action: { kind: 'swipe', start: { xPoints: 1, yPoints: 2 }, end: { xPoints: 3, yPoints: 4 }, durationMs: 250 },
    })
    expect(swipe.actedAt).toEqual({ xPoints: 1, yPoints: 2 })
    const key = await suite.provider.input({ action: { kind: 'key', usage: 40 } })
    expect(key.actedAt).toBeUndefined()
    const entry = await suite.provider.input({
      action: { kind: 'text', target: { kind: 'point', at: { xPoints: 30, yPoints: 40 } }, text: 'ignored by the stub' },
    })
    expect(entry.actedAt).toEqual({ xPoints: 30, yPoints: 40 })
  }, 30_000)

  it('streams encoded video chunks until stopped', async () => {
    const suite = await mountedProvider({ helperPath: fixture('stream-helper.mjs') })
    mounted.push(suite)
    const stream = await suite.provider.startStream({ codec: 'h264', frameRate: 24 })
    expect(stream.codec).toBe('h264')
    const seen: number[] = []
    for await (const chunk of stream.frames) {
      seen.push([...chunk.values()][0] as number)
      if (seen.length === 3) break
    }
    expect(seen).toEqual([11, 22, 33])
    await stream.stop()
  }, 30_000)

  it('accepts provider-configured stream knobs and validates them loud', async () => {
    const ctx = new Context()
    await ctx.plugin(LocalSubprocessRuntime)
    for (const config of [
      { helperPath: fixture('stream-helper.mjs'), streamCodec: 'vp9' },
      { helperPath: fixture('stream-helper.mjs'), streamFrameRate: 0 },
      { helperPath: fixture('stream-helper.mjs'), streamScale: 1.5 },
    ]) {
      await expect(ctx.plugin(NativeSimulatorProvider, config)).rejects.toThrow()
    }
  })

  it('rejects a stream on a provider that advertises nothing, with the unavailable-code identity', async () => {
    const ctx = new Context()
    await ctx.plugin(LocalSubprocessRuntime)
    class BareProvider extends IosSimulator {
      override get capabilities(): ReadonlySet<SimulatorCapability> {
        return new Set()
      }

      override get providerName(): string {
        return '@deepseek-ai/dsh-ios-sim-native/bare'
      }
    }
    await ctx.plugin(BareProvider)
    const error = await ctx.iosSimulator.startStream({}).catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(SimulatorError)
    expect((error as SimulatorError).code).toBe('SIMULATOR_CAPABILITY_UNAVAILABLE')
  })

  it('wraps a synchronously throwing spawn as an unavailable helper', async () => {
    const ctx = new Context()
    await ctx.plugin(ThrowingSubprocess)
    await ctx.plugin(NativeSimulatorProvider, { helperPath: fixture('good-helper.mjs') })
    const error = await (ctx.iosSimulator as NativeSimulatorProvider).describe({}).catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(SimulatorError)
    expect((error as SimulatorError).code).toBe('SIMULATOR_HELPER_UNAVAILABLE')
    expect((error as SimulatorError).message).toContain('could not be launched')
  })

  it('classifies a spawn-level failure after a handle exists as a dead helper', async () => {
    const ctx = new Context()
    await ctx.plugin(RejectingDoneSubprocess)
    await ctx.plugin(NativeSimulatorProvider, { helperPath: fixture('good-helper.mjs') })
    const error = await (ctx.iosSimulator as NativeSimulatorProvider).describe({}).catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(SimulatorError)
    expect((error as SimulatorError).code).toBe('SIMULATOR_HELPER_UNAVAILABLE')
    expect((error as SimulatorError).message).toContain('failed to spawn')
  })

  it('reads a stdout close with a live child as a framing breach, not an exit', async () => {
    const suite = await mountedProvider({ helperPath: fixture('close-stdout-helper.mjs'), maxRestarts: 1 })
    mounted.push(suite)
    const error = await suite.provider.describe({}).catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(SimulatorError)
    expect((error as SimulatorError).code).toBe('SIMULATOR_HELPER_PROTOCOL_BROKEN')
    expect((error as SimulatorError).message).toContain('while still running')
  })

  it('covers the entry-package helper-path default when no override is set', async () => {
    const suite = await mountedProvider({})
    mounted.push(suite)
    // helperPath resolves through the entry package; on this host the
    // platform package exists, on others the deterministic fallback. Either
    // way the plan carries an absolute path without existence promises.
    expect(suite.provider.resolveHelper().helperPath.startsWith('/')).toBe(true)
  })

  it('passes a named seam code through and classifies a foreign one as a request failure', async () => {
    const suite = await mountedProvider({ helperPath: fixture('error-helper.mjs'), maxRestarts: 1 })
    mounted.push(suite)
    const seamError = await suite.provider.describe({}).catch((cause: unknown) => cause)
    expect(seamError).toBeInstanceOf(SimulatorError)
    // The helper answered in the seam vocabulary: the code crosses verbatim.
    expect((seamError as SimulatorError).code).toBe('SIMULATOR_DEVICE_NOT_FOUND')
    expect((seamError as SimulatorError).message).toContain('matches "GHOST"')

    // A restart happens (the helper kept serving): the second answer carries
    // a foreign code, which the provider names under its own failure class.
    const foreignError = await suite.provider.describe({}).catch((cause: unknown) => cause)
    expect((foreignError as SimulatorError).code).toBe('SIMULATOR_HELPER_REQUEST_FAILED')
    expect((foreignError as SimulatorError).message).toContain('WEIRD_SUBSTRATE_FAILURE')
  }, 30_000)

  it('keeps a foreign, malformed error payload visible under the request-failure class', async () => {
    const suite = await mountedProvider({ helperPath: fixture('nonstring-error-helper.mjs'), maxRestarts: 1 })
    mounted.push(suite)
    const error = await suite.provider.describe({}).catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(SimulatorError)
    expect((error as SimulatorError).code).toBe('SIMULATOR_HELPER_REQUEST_FAILED')
    expect((error as SimulatorError).message).toContain('\"code\":42')
  }, 30_000)

  it('reads an answer whose frame id does not match the in-flight request as a breach', async () => {
    const suite = await mountedProvider({ helperPath: fixture('wrong-id-helper.mjs'), maxRestarts: 1 })
    mounted.push(suite)
    const error = await suite.provider.describe({}).catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(SimulatorError)
    expect((error as SimulatorError).code).toBe('SIMULATOR_HELPER_PROTOCOL_BROKEN')
    expect((error as SimulatorError).message).toContain('no matching in-flight request')
  })

  it('ends the helper on ITS OWN disposal and waits for it to reach EOF (the HMR-safety proof)', async () => {
    const suite = await mountedProvider({ helperPath: fixture('good-helper.mjs') })
    mounted.push(suite)
    await suite.provider.describe({})
    // Disposing the provider's own fiber — not the whole composition — is
    // what a provider reload does: its teardown effect must close the helper
    // gracefully and await the child's exit before returning.
    await suite.disposeProvider()
    mounted.length = 0 // afterEach must not dispose again
    expect(readFileSync(suite.marker, 'utf8')).toContain('eof')
  }, 30_000)
})

describe('load-time loudness', () => {
  it('refuses to construct off-macOS', async () => {
    const ctx = new Context()
    await ctx.plugin(LocalSubprocessRuntime)
    vi.stubGlobal('process', { ...process, platform: 'linux' })
    try {
      expect(() => new NativeSimulatorProvider(ctx, { helperPath: 'x' })).toThrow(/only on macOS/)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('rejects misconfigured budgets at construction', async () => {
    const base = { helperPath: fixture('good-helper.mjs') }
    for (const config of [
      { ...base, timeoutMs: 0 },
      { ...base, maxTimeoutMs: 100, timeoutMs: 200 },
      { ...base, maxRestarts: 0 },
      { ...base, graceMs: 1e12 },
    ]) {
      const ctx = new Context()
      await ctx.plugin(LocalSubprocessRuntime)
      await expect(ctx.plugin(NativeSimulatorProvider, config)).rejects.toThrow()
    }
  })

  it('plans calls through the explicit resolve step, clamping deadlines', async () => {
    const suite = await mountedProvider({ helperPath: fixture('good-helper.mjs'), timeoutMs: 1_000, maxTimeoutMs: 5_000 })
    mounted.push(suite)
    expect(suite.provider.resolve()).toMatchObject({ helperPath: fixture('good-helper.mjs'), timeoutMs: 1_000 })
    expect(suite.provider.resolve({ timeoutMs: 99_999 })).toMatchObject({ timeoutMs: 5_000 })
    const overridden = await mountedProvider({ helperPath: '/custom/helper', graceMs: 100 })
    mounted.push(overridden)
    expect(overridden.provider.resolve()).toMatchObject({ helperPath: '/custom/helper' })
  })
})

// The spawnSync probe backstops the fixture contract: a fixture that lost its
// executable bit fails here with a named message instead of a mysterious
// spawn failure in every test above.
for (const file of ['good-helper.mjs', 'flaky-helper.mjs', 'always-dies-helper.mjs', 'slow-helper.mjs', 'no-hello-helper.mjs', 'wrong-protocol-helper.mjs']) {
  const path = fixture(file)
  if (!existsSync(path)) throw new Error(`fixture ${file} is missing`)
  const probe = spawnSync(path, { input: '', timeout: 2_000 })
  const spawnError = probe.error
  if (spawnError !== undefined) {
    // Only ENOENT/EACCES land here with a code; a timeout carries ETIMEDOUT
    // and means the stub simply kept serving, which the fixtures above allow.
    const code = (spawnError as NodeJS.ErrnoException).code
    if (code !== 'ETIMEDOUT') {
      throw new Error(`fixture ${file} is not directly executable (${code}); restore its chmod +x`)
    }
  }
}
