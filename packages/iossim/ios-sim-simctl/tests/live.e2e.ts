/**
 * Live-substrate acceptance for the simctl provider, SELF-SKIPPING unless a
 * usable Xcode with available simulators is present. The substrate probe runs
 * ONCE at module load (synchronously), because `describe.skipIf` reads its
 * argument at collection time — a beforeAll-era flag would already be too
 * late. Every test below then drives the REAL `xcrun simctl` surface through
 * the provider's own subprocess seam.
 */

import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import {
  SIMCTL_ALLOWLIST,
  assertIosDeveloperDir,
  developerDirFromSelectOutput,
  SimctlSimulatorProvider,
} from '../src/index.ts'

function run(cmd: string, args: string[]): string {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    // A missing binary or a sandbox denial reads as "no substrate" — an
    // identical skip either way; the real runs report their own failures.
    return ''
  }
}

/** One-shot substrate probe: platform, selection, iOS platform, and devices. */
function substrateUsable(): boolean {
  if (process.platform !== 'darwin') return false
  const selection = run('/usr/bin/xcode-select', ['-p'])
  if (!selection.trim().startsWith('/')) return false
  try {
    assertIosDeveloperDir(developerDirFromSelectOutput(selection))
  } catch {
    return false // Xcode present but no iOS simulator platform installed
  }
  return /Booted|Shutdown/.test(run('/usr/bin/xcrun', ['simctl', 'list', 'devices', 'available']))
}

const usable = substrateUsable()

async function mountedProvider(): Promise<SimctlSimulatorProvider> {
  // Mount through the loader so the static Config applies its real defaults.
  const ctx = new Context()
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(SimctlSimulatorProvider)
  return ctx.get('iosSimulator') as SimctlSimulatorProvider
}

describe.skipIf(!usable)('live xcrun simctl surface', () => {
  it('resolves the developer directory and lists devices with ids and states', async () => {
    const provider = await mountedProvider()
    const devices = await provider.list()
    expect(devices.length).toBeGreaterThan(0)
    expect(devices[0]?.id).toBeDefined()
    expect(['booted', 'shutdown']).toContain(devices[0]?.state)
  })

  it('captures a PNG whose pixel size parses out of IHDR', async () => {
    const provider = await mountedProvider()
    const shot = await provider.screenshot({})
    expect(shot.mediaType).toBe('image/png')
    expect(shot.data.byteLength).toBeGreaterThan(0)
    expect(shot.widthPx).toBeGreaterThan(0)
    expect(shot.heightPx).toBeGreaterThan(0)
  })

  it('keeps tap-shaped substrates out of the allowlist', () => {
    // The public simctl surface exposes no input verbs; the fixed allowlist is
    // the structural guarantee that later phases cannot sneak argv through.
    expect(SIMCTL_ALLOWLIST.has('tap')).toBe(false)
    expect(SIMCTL_ALLOWLIST.has('sendpush')).toBe(false)
  })
})
