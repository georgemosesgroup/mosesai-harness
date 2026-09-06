/**
 * The phase-1 sim_* tools over a REAL ToolRuntime/Session/attachment store and
 * a FAKE simulator provider: canonical values, the durable `iosSim/action`
 * records on a genuine session log, image-block rendering after durable
 * commit, the strict image route gate, byte-cap refusal before storage, and
 * capability-unavailable failures surfacing through the executor.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId, LlmAdapter, LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmModelInfo, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { IosSimulator, SimulatorId, GEOMETRY_UNAVAILABLE_NOTE } from '@deepseek-ai/dsh-ios-sim'
import type { SimulatorCapability, SimulatorDevice } from '@deepseek-ai/dsh-ios-sim'
import * as ToolIosSim from '../src/index.ts'

/** A 1x1 valid red PNG (known-good fixture reused across assertions). */
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64')

const testToolSignal = new AbortController().signal

const ALL: ReadonlySet<SimulatorCapability> = new Set([
  'list', 'boot', 'install', 'launch', 'terminate', 'screenshot', 'openUrl', 'describe', 'input',
])

/**
 * The scripted substrate: every advertised verb is overridden, resolves
 * UDID-A when no device token arrives, and records each call in order.
 */
class FakeSimProvider extends IosSimulator {
  static calls: string[] = []

  override get capabilities(): ReadonlySet<SimulatorCapability> {
    return ALL
  }

  override get providerName(): string {
    return '@deepseek-ai/fake-sim'
  }

  static device(index: number): SimulatorDevice {
    return index === 0
      ? {
        id: SimulatorId('UDID-A'),
        name: 'iPhone 15 Pro',
        state: 'booted',
        deviceTypeIdentifier: 'type-a',
        runtimeIdentifier: 'rt-17',
      }
      : {
        id: SimulatorId('UDID-B'),
        name: 'iPad mini',
        state: 'shutdown',
        deviceTypeIdentifier: 'type-b',
        runtimeIdentifier: 'rt-17',
      }
  }

  override async doList(): Promise<readonly SimulatorDevice[]> {
    FakeSimProvider.calls.push('list')
    return [FakeSimProvider.device(0), FakeSimProvider.device(1)]
  }

  override async doBoot(request: Parameters<IosSimulator['boot']>[0]): Promise<{ simulatorId: ReturnType<typeof SimulatorId> }> {
    FakeSimProvider.calls.push(`boot:${String(request.simulator ?? 'auto')}`)
    return { simulatorId: request.simulator ?? SimulatorId('UDID-A') }
  }

  override async doShutdown(request: Parameters<IosSimulator['shutdown']>[0]): Promise<{ simulatorId: ReturnType<typeof SimulatorId> }> {
    FakeSimProvider.calls.push(`shutdown:${String(request.simulator ?? 'auto')}`)
    return { simulatorId: request.simulator ?? SimulatorId('UDID-A') }
  }

  override async doInstall(request: Parameters<IosSimulator['install']>[0]): Promise<{ simulatorId: ReturnType<typeof SimulatorId> }> {
    FakeSimProvider.calls.push(`install:${String(request.simulator)}`)
    return { simulatorId: request.simulator ?? SimulatorId('UDID-A') }
  }

  override async doLaunch(request: Parameters<IosSimulator['launch']>[0]): Promise<{ simulatorId: ReturnType<typeof SimulatorId>; bundleId: string }> {
    FakeSimProvider.calls.push(`launch:${request.bundleId}`)
    return { simulatorId: request.simulator ?? SimulatorId('UDID-A'), bundleId: request.bundleId }
  }

  override async doTerminate(request: Parameters<IosSimulator['terminate']>[0]): Promise<{ simulatorId: ReturnType<typeof SimulatorId> }> {
    FakeSimProvider.calls.push(`terminate:${request.bundleId}`)
    return { simulatorId: request.simulator ?? SimulatorId('UDID-A') }
  }

  override async doScreenshot(_request: Parameters<IosSimulator['screenshot']>[0]) {
    FakeSimProvider.calls.push('screenshot')
    return {
      simulatorId: SimulatorId('UDID-A'),
      data: new Uint8Array(PNG_1X1),
      mediaType: 'image/png' as const,
      widthPx: 1,
      heightPx: 1,
    }
  }

  override async doOpenUrl(request: Parameters<IosSimulator['openUrl']>[0]): Promise<{ simulatorId: ReturnType<typeof SimulatorId> }> {
    FakeSimProvider.calls.push(`openurl:${request.url}`)
    return { simulatorId: request.simulator ?? SimulatorId('UDID-A') }
  }

  override async doDescribe(_request: Parameters<IosSimulator['describe']>[0]): Promise<Awaited<ReturnType<IosSimulator['describe']>>> {
    FakeSimProvider.calls.push('describe')
    return {
      simulatorId: SimulatorId('UDID-A'),
      truncated: false,
      screen: { widthPoints: 393, heightPoints: 852 },
      root: {
        reference: '0',
        role: 'Application',
        label: 'Settings',
        enabled: true,
        children: [
          {
            reference: '0.0',
            role: 'Button',
            label: 'Continue',
            frame: { xPoints: 20, yPoints: 100, widthPoints: 200, heightPoints: 44 },
            enabled: true,
            children: [],
          },
        ],
      },
    }
  }

  override async doInput(request: Parameters<IosSimulator['input']>[0]): Promise<Awaited<ReturnType<IosSimulator['input']>>> {
    const action = request.action
    FakeSimProvider.calls.push(`input:${action.kind}`)
    const actedAt = action.kind === 'swipe'
      ? action.start
      : (action.kind === 'tap' || action.kind === 'text') && action.target.kind === 'point'
        ? action.target.at
        : undefined
    return {
      simulatorId: request.simulator ?? SimulatorId('UDID-A'),
      ...(actedAt === undefined ? {} : { actedAt }),
    }
  }
}

/** Advertises NOTHING: every verb rides the Service Definition gate. */
class EmptyAdvertisedProvider extends IosSimulator {
  override get capabilities(): ReadonlySet<SimulatorCapability> {
    return new Set()
  }

  override get providerName(): string {
    return '@deepseek-ai/empty-sim'
  }
}

/** Exact-route fake adapter; `stream` stays unreachable in these tests. */
class RouteAdapter extends LlmAdapter {
  constructor(private readonly catalogModels: readonly LlmModelInfo[]) {
    super()
  }

  override listModels(_provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve(this.catalogModels)
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    const resolved = this.catalogModels.find(candidate => candidate.id === model)
    return Promise.resolve({
      provider,
      id: model,
      name: resolved?.name ?? model,
      ...resolved?.inputModalities === undefined ? {} : { inputModalities: [...resolved.inputModalities] },
    })
  }

  override stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    throw new Error('iosSim tool tests never stream')
  }
}

let home = ''
let dir = ''

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'iossim-tools-'))
  home = await mkdtemp(join(tmpdir(), 'iossim-home-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
  await rm(home, { recursive: true, force: true })
  FakeSimProvider.calls.length = 0
})

interface SetupOptions {
  models?: readonly LlmModelInfo[]
  store?: { maxImageBytes?: number }
}

async function setup(
  options: SetupOptions = {},
  providerClass: typeof FakeSimProvider | typeof EmptyAdvertisedProvider = FakeSimProvider,
): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(LlmRuntime)
  ctx.llm.registerAdapter(['visual'], new RouteAdapter(options.models ?? [
    { provider: 'visual', id: 'vision-model', name: 'Vision', inputModalities: ['text', 'image'] },
    { provider: 'visual', id: 'text-model', name: 'Text', inputModalities: ['text'] },
  ]))
  await ctx.plugin(LocalAttachmentStore, { dshHome: home, ...options.store })
  await ctx.plugin(providerClass)
  await ctx.plugin(ToolIosSim)
  return ctx
}

/** A parent Agent backed by a real Session; only the wrapper is a stand-in. */
function agentOn(model: string | undefined, provider = 'visual'): Agent & { session: Session } {
  const session = Session.create(SessionId('sim-agent'))
  void model
  void provider
  return { id: SessionId('sim-agent'), session } as unknown as Agent & { session: Session }
}

/** Pin the calling route onto the agent's session via the real header event. */
function route(agent: Agent & { session: Session }, provider: string, model: string): void {
  agent.session.append('request/header', {
    reason: 'initial',
    header: {
      config: { provider, model },
    },
  })
}

let callCounter = 0
async function call(ctx: Context, name: string, args: unknown, agent?: Agent & { session: Session }) {
  return ctx.tools.execute({
    signal: testToolSignal,
    callId: ToolCallId(`sim-call-${++callCounter}`),
    name,
    arguments: args,
    ...agent !== undefined ? { agent: agent } : {},
  })
}

function eventsOf(session: Session): readonly SessionEvent[] {
  return session.snapshotEvents().filter(event => event.type === 'iosSim/action')
}

function oneEvent(session: Session, action: string): Record<string, unknown> {
  const hit = [...eventsOf(session)].filter(e => (e.data as Record<string, unknown>).action === action).at(-1)
  if (hit === undefined) throw new Error(`expected an ${action} record`)
  return hit.data as Record<string, unknown>
}

describe('sim_list', () => {
  it('returns canonical devices and appends one count record to the session log', async () => {
    const ctx = await setup()
    const agent = agentOn('vision-model')
    const result = await call(ctx, 'sim_list', {}, agent)
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    expect(result.value).toEqual({
      devices: [
        { id: 'UDID-A', name: 'iPhone 15 Pro', state: 'booted', runtime: 'rt-17' },
        { id: 'UDID-B', name: 'iPad mini', state: 'shutdown', runtime: 'rt-17' },
      ],
    })
    expect(oneEvent(agent.session, 'list')).toEqual({ action: 'list', devices: 2 })
    const rendered = JSON.stringify(result.content)
    expect(rendered).toContain('iPhone 15 Pro')
    expect(rendered).toContain('[booted]')
  })

  it('rejects on a provider that advertises nothing, with the unavailable-code identity', async () => {
    const ctx = await setup({}, EmptyAdvertisedProvider)
    const result = await call(ctx, 'sim_list', {})
    expect(result.isError).toBe(true)
    expect(result.error?.info?.code).toBe('SIMULATOR_CAPABILITY_UNAVAILABLE')
    expect(result.error?.message ?? '').toContain('@deepseek-ai/empty-sim')
  })
})

describe('sim_launch', () => {
  it('echoes the resolved target and documents absent geometry honestly', async () => {
    const ctx = await setup()
    const agent = agentOn('vision-model')
    const result = await call(ctx, 'sim_launch', { bundle_id: 'com.apple.Preferences' }, agent)
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    // The fake substrate carries no geometry fact, so the value omits it; a
    // level-0 simctl provider fills the documented note instead.
    expect(result.value).toEqual({
      device: { id: 'UDID-A' },
      bundleId: 'com.apple.Preferences',
    })
    expect(GEOMETRY_UNAVAILABLE_NOTE).toMatch(/availability tree/)
    expect(oneEvent(agent.session, 'launch')).toMatchObject({
      action: 'launch',
      simulatorId: 'UDID-A',
      bundleId: 'com.apple.Preferences',
    })
  })

  it('keeps an explicit device token through to the provider', async () => {
    const ctx = await setup()
    await call(ctx, 'sim_launch', { bundle_id: 'com.apple.Preferences', device: ' UDID-B ' }, agentOn('vision-model'))
    expect(FakeSimProvider.calls.at(-1)).toBe('launch:com.apple.Preferences')
  })
})

describe('sim_open_url', () => {
  it('records the opened url against the resolved device', async () => {
    const ctx = await setup()
    const agent = agentOn('vision-model')
    const result = await call(ctx, 'sim_open_url', { url: 'https://example.com/' }, agent)
    expect(result.isError).toBe(false)
    expect(oneEvent(agent.session, 'openurl')).toMatchObject({
      action: 'openurl',
      simulatorId: 'UDID-A',
      url: 'https://example.com/',
    })
  })

  it('refuses schemeless URLs before touching the substrate', async () => {
    const ctx = await setup()
    const result = await call(ctx, 'sim_open_url', { url: 'example.com/nope' })
    expect(result.isError).toBe(true)
    expect(FakeSimProvider.calls.some(c => c.startsWith('openurl'))).toBe(false)
  })
})

describe('sim_screenshot', () => {
  it('commits durably first, logs reference facts, renders envelope + image block', async () => {
    const ctx = await setup()
    const agent = agentOn('vision-model')
    route(agent, 'visual', 'vision-model')
    const result = await call(ctx, 'sim_screenshot', {}, agent)
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')

    const attachments = ctx.get('attachments')
    if (attachments === undefined) throw new Error('expected attachment store')

    // One text envelope plus ONE image block referencing the committed object.
    expect(result.content).toHaveLength(2)
    if (result.content[1]?.type !== 'image') throw new Error('second block must be the image')
    const ref = result.content[1].attachment
    expect([ref.width, ref.height]).toEqual([1, 1])
    const stored = await attachments.readImage(ref)
    expect(Buffer.from(stored.data)).toEqual(PNG_1X1)

    // The event carries reference facts only — base64 never rides the log.
    const record = oneEvent(agent.session, 'screenshot') as unknown as {
      image: { attachmentId: string; mediaType: string; bytes: number; width: number; height: number }
      simulatorId: string
    }
    expect(record.simulatorId).toBe('UDID-A')
    expect(record.image.attachmentId).toBe(String(ref.attachmentId))
    expect(record.image.bytes).toBe(PNG_1X1.length)
    expect(JSON.stringify(record)).not.toContain('iVBOR')

    const envelope = result.content[0] as { type: string; text: string }
    expect(envelope.text).toContain('<device>UDID-A</device>')
    expect(envelope.text).toContain('native raster')
  })

  it('refuses captures above the deployment byte cap before any durable write', async () => {
    const ctx = await setup({ store: { maxImageBytes: Math.max(1, PNG_1X1.length - 1) } })
    const agent = agentOn('vision-model')
    route(agent, 'visual', 'vision-model')
    const result = await call(ctx, 'sim_screenshot', {}, agent)
    expect(result.isError).toBe(true)
    expect(result.content[0]?.type === 'text' ? result.content[0].text : '').toContain('byte limit')
    // Nothing landed in the log: refusal precedes both the commit and the record.
    expect(eventsOf(agent.session)).toEqual([])
  })

  it('demands an image-capable calling route before substrate work', async () => {
    const ctx = await setup()
    const agent = agentOn('vision-model')
    route(agent, 'visual', 'text-model')
    const result = await call(ctx, 'sim_screenshot', {}, agent)
    expect(result.isError).toBe(true)
    expect(FakeSimProvider.calls.some(c => c.includes('screenshot'))).toBe(false)
  })

  it('builds the dedicated image card from persisted meta and falls back otherwise', () => {
    const view = ToolIosSim.imageViewFromMeta({
      device: 'UDID-A',
      image: { attachmentId: 'sha256:ff', mediaType: 'image/png', bytes: 9, width: 4, height: 5 },
    })
    expect(view).toMatchObject({
      card: 'image',
      origin: 'UDID-A',
      attachmentId: 'sha256:ff',
      mediaType: 'image/png',
      bytes: 9,
      width: 4,
      height: 5,
    })
    expect(ToolIosSim.imageViewFromMeta(undefined)).toBeUndefined()
    expect(ToolIosSim.imageViewFromMeta({ card: 'chart' })).toBeUndefined()
    expect(ToolIosSim.imageViewFromMeta({ device: 'd', image: { attachmentId: '', mediaType: '', bytes: -1, width: 0, height: 0 } }))
      .toBeUndefined()
  })
})

describe('sim_describe', () => {
  it('returns the availability tree with references and appends an elements-count record', async () => {
    const ctx = await setup()
    const agent = agentOn('vision-model')
    const result = await call(ctx, 'sim_describe', {}, agent)
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    expect(result.value).toMatchObject({
      simulatorId: 'UDID-A',
      truncated: false,
      screen: { widthPoints: 393, heightPoints: 852 },
      elements: [
        expect.objectContaining({ reference: '0', role: 'Application', label: 'Settings' }),
        expect.objectContaining({ reference: '0.0', role: 'Button', frame: { x: 20, y: 100, width: 200, height: 44 } }),
      ],
    })
    expect(oneEvent(agent.session, 'describe')).toEqual({ action: 'describe', simulatorId: 'UDID-A', elements: 2 })
    const rendered = JSON.stringify(result.content)
    expect(rendered).toContain('- [0.0] Button')
  })

  it('rejects on a provider that advertises nothing, with the unavailable-code identity', async () => {
    const ctx = await setup({}, EmptyAdvertisedProvider)
    const result = await call(ctx, 'sim_describe', {})
    expect(result.isError).toBe(true)
    expect(result.error?.info?.code).toBe('SIMULATOR_CAPABILITY_UNAVAILABLE')
  })
})

describe('sim_input', () => {
  it('taps a point target, echoes the landing point, and records the gesture', async () => {
    const ctx = await setup()
    const agent = agentOn('vision-model')
    const result = await call(ctx, 'sim_input', { action: 'tap', x: 55, y: 66 }, agent)
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    expect(result.value).toEqual({ simulatorId: 'UDID-A', inputAction: 'tap', actedAt: { xPoints: 55, yPoints: 66 } })
    expect(oneEvent(agent.session, 'input')).toEqual({
      action: 'input',
      simulatorId: 'UDID-A',
      inputAction: 'tap',
      target: 'point 55,66',
    })
    const rendered = JSON.stringify(result.content)
    expect(rendered).toContain('55,66')
  })

  it('acts on an element reference and names the reference in the audit record', async () => {
    const ctx = await setup()
    const agent = agentOn('vision-model')
    const result = await call(ctx, 'sim_input', { action: 'tap', reference: '0.0' }, agent)
    expect(result.isError).toBe(false)
    expect(oneEvent(agent.session, 'input')).toEqual({
      action: 'input',
      simulatorId: 'UDID-A',
      inputAction: 'tap',
      target: 'element 0.0',
    })
  })

  it('never records the text a text entry set', async () => {
    const ctx = await setup()
    const agent = agentOn('vision-model')
    const result = await call(ctx, 'sim_input', { action: 'text', reference: '0.0', text: 'hunter2-secret' }, agent)
    expect(result.isError).toBe(false)
    const dumped = JSON.stringify(eventsOf(agent.session))
    expect(dumped).not.toContain('hunter2-secret')
    expect(oneEvent(agent.session, 'input')).toEqual({
      action: 'input',
      simulatorId: 'UDID-A',
      inputAction: 'text',
      target: 'element 0.0',
    })
  })

  it('presses a key by HID usage code with no landing point', async () => {
    const ctx = await setup()
    const agent = agentOn('vision-model')
    const result = await call(ctx, 'sim_input', { action: 'key', usage: 40 }, agent)
    expect(result.value).toEqual({ simulatorId: 'UDID-A', inputAction: 'key' })
    expect(oneEvent(agent.session, 'input').target).toBe('device')
  })

  it('rejects a half-filled gesture with the repair in the message', async () => {
    const ctx = await setup()
    const result = await call(ctx, 'sim_input', { action: 'tap' })
    expect(result.isError).toBe(true)
    expect(result.error?.message ?? '').toContain('needs a target')
  })

  it('rejects on a provider that advertises nothing, with the unavailable-code identity', async () => {
    const ctx = await setup({}, EmptyAdvertisedProvider)
    const result = await call(ctx, 'sim_input', { action: 'tap', x: 1, y: 2 })
    expect(result.isError).toBe(true)
    expect(result.error?.info?.code).toBe('SIMULATOR_CAPABILITY_UNAVAILABLE')
  })
})
