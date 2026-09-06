/**
 * Contract-level units of the iOS-simulator Service Definition: capability
 * gating messages/codes, the loud unimplemented-hook wall, the target
 * vocabulary mapping, and the advertisement↔override consistency helper — all
 * against hand-built subclasses (the substrate stays out of scope here).
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  GEOMETRY_UNAVAILABLE_NOTE,
  IosSimulator,
  SIMULATOR_CAPABILITIES,
  SimulatorId,
  VERB_CAPABILITY,
  unadvertisedCapabilities,
} from '../src/index.ts'
import type { SimulatorCapability } from '../src/index.ts'

/** Minimal fake: advertises `subset`, implements nothing beyond the hooks given. */
class FakeProvider extends IosSimulator {
  constructor(ctx: Context, readonly subset: ReadonlySet<SimulatorCapability>, readonly label = 'fake-provider') {
    super(ctx)
    // Override whichever advertised hooks the test hands in, via prototype ops
    // performed by helpers below; base defaults stay rejecting.
  }

  override get capabilities(): ReadonlySet<SimulatorCapability> {
    return this.subset
  }

  override get providerName(): string {
    return this.label
  }
}

function mounted(subset: SimulatorCapability[], label?: string): { ctx: Context; provider: FakeProvider } {
  const ctx = new Context()
  const provider = new FakeProvider(ctx, new Set<SimulatorCapability>(subset), label)
  return { ctx, provider }
}

describe('capability gating', () => {
  it('rejects an unadvertised verb with code, missing capability, and provider name', async () => {
    const { provider } = mounted(['list'])
    await expect(provider.input({ action: { kind: 'tap', target: { kind: 'point', at: { xPoints: 1, yPoints: 2 } } } })).rejects.toMatchObject({ code: 'SIMULATOR_CAPABILITY_UNAVAILABLE' })
    await expect(provider.describe({})).rejects.toMatchObject({ code: 'SIMULATOR_CAPABILITY_UNAVAILABLE' })
    // The message names both pieces the task's contract requires:
    await expect(provider.boot({})).rejects.toThrow(/does not declare the "boot" capability/)
    await expect(provider.boot({})).rejects.toThrow(/fake-provider/)
  })

  it('rejects an advertised-but-unimplemented hook equally loud', async () => {
    const { provider } = mounted(['boot']) // advertised; doBoot/doShutdown never overridden
    await expect(provider.boot({ simulator: SimulatorId('UDID') })).rejects.toMatchObject({ code: 'SIMULATOR_CAPABILITY_UNAVAILABLE' })
  })

  it('shutdown rides the boot capability; stream gates its own capability', () => {
    expect(VERB_CAPABILITY.shutdown).toBe('boot')
    expect(VERB_CAPABILITY.list).toBe('list')
    expect(VERB_CAPABILITY.stream).toBe('stream')
    // The closed ten-name vocabulary is fully mapped to verbs now.
    expect([...SIMULATOR_CAPABILITIES]).toContain('stream')
    expect(Object.keys(VERB_CAPABILITY)).toHaveLength(11)
  })

  it('consistency helper reports advertised capabilities whose hooks stayed defaulted', () => {
    const missing = mounted(['list', 'input']).provider
    expect([...unadvertisedCapabilities(missing)].sort()).toEqual(['input', 'list'])
    expect(unadvertisedCapabilities(consistentProvider())).toEqual([])
  })

  /** A fake implementing every hook it advertises, built by declaration-merging style overrides. */
  function consistentProvider(): IosSimulator {
    const { provider } = mounted(['list'])
    // Instance-level override mirrors what a real subclass does: the helper
    // compares against the Service Definition's base methods only.
    const proto = provider as unknown as { doList?: () => Promise<readonly never[]> }
    proto.doList = (): Promise<readonly never[]> => Promise.resolve([])
    return provider
  }
})

describe('geometry honesty', () => {
  it('exports the documented absence note for level-0 providers', () => {
    expect(GEOMETRY_UNAVAILABLE_NOTE).toMatch(/availability tree/)
  })
})
