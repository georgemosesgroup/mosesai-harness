/**
 * Units of the simctl provider's pure decision layer: device-list parsing,
 * launch output parsing, PNG IHDR facts, developer-dir interpretation with its
 * DISTINCT repair codes, target resolution with its three failure modes, and
 * the subcommand allowlist. The real provider class additionally refuses to
 * construct off-macOS; the live-substrate suite is separate (self-skipping).
 */
import { describe, expect, it } from 'vitest'
import { SimulatorError, SimulatorId } from '@deepseek-ai/dsh-ios-sim'
import {
  SIMCTL_ALLOWLIST,
  assertIosDeveloperDir,
  developerDirFromSelectOutput,
  resolveSimulatorTarget,
} from '../src/index.ts'
import { parseDeviceList, parseLaunchOutput, pngPixelSize } from '../src/parse.ts'

const LIST_JSON = `{
  "devpreruntime": {},
  "devices": {
    "com.apple.CoreSimulator.SimRuntime.iOS-17-5": [
      { "lastBootedAt": "2026-01-01T00:00:00Z", "udid": "AAA-1", "isAvailable": true,
        "state": "Shutdown", "name": "iPhone 15 Pro",
        "deviceTypeIdentifier": "com.apple.CoreSimulator.SimDeviceType.iPhone-15-Pro" },
      { "lastBootedAt": "2026-01-01T01:00:00Z", "udid": "BBB-2", "state": "Booted",
        "name": "iPhone 15", "deviceTypeIdentifier": "com.apple.CoreSimulator.SimDeviceType.iPhone-15" },
      { "udid": "OFF-3", "state": "Shutdown", "name": "Hidden", "isAvailable": false }
    ]
  }
}`

describe('device list parsing', () => {
  it('maps substrate rows onto seam devices in order, honoring availability', () => {
    const devices = parseDeviceList(LIST_JSON)
    expect(devices.map(d => String(d.id))).toEqual(['AAA-1', 'BBB-2'])
    expect(devices[0]).toMatchObject({ state: 'shutdown', name: 'iPhone 15 Pro' })
    expect(devices[1]).toMatchObject({ state: 'booted', runtimeIdentifier: 'com.apple.CoreSimulator.SimRuntime.iOS-17-5' })
  })

  it('collapses richer lifecycle states to the seam power pair without dropping devices', () => {
    const raw = '{"devices":{"rt":[{"udid":"U","name":"N","state":"Creating"}]}}'
    expect(parseDeviceList(raw)).toEqual([
      expect.objectContaining({ id: SimulatorId('U'), state: 'shutdown' }),
    ])
  })

  it('rejects non-JSON or wrong-shaped payloads loud', () => {
    expect(() => parseDeviceList('not json')).toThrow()
    expect(() => parseDeviceList('{"x":1}')).toThrow(/devices map/)
  })
})

describe('launch output parsing', () => {
  it('reads the bundle id and optional pid', () => {
    expect(parseLaunchOutput('com.apple.Preferences: 4242\n', 'com.apple.Preferences'))
      .toEqual({ bundleId: 'com.apple.Preferences', pid: 4242 })
    expect(parseLaunchOutput('com.apple.Preferences\n', 'com.apple.Preferences'))
      .toEqual({ bundleId: 'com.apple.Preferences', pid: undefined })
  })

  it('refuses output that does not name the expected bundle', () => {
    expect(() => parseLaunchOutput('', 'com.other')).toThrow(/did not name/)
  })
})

describe('png raster facts', () => {
  const ONE_BY_TWO = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01,
    0x00, 0x00, 0x00, 0x02,
    0x08, 0x06, 0x00, 0x00, 0x00,
    0x1f, 0x15, 0xc4, 0x89,
  ])

  it('reads pixel size straight from IHDR; rejects foreign bytes', () => {
    expect(pngPixelSize(ONE_BY_TWO)).toEqual({ widthPx: 1, heightPx: 2 })
    expect(() => pngPixelSize(new Uint8Array([1, 2, 3]))).toThrow(/not a PNG/)
  })

  it('rejects a valid-looking image whose first chunk is not IHDR', () => {
    const wrong = new Uint8Array(ONE_BY_TWO)
    // First chunk type bytes at offset 12..16: swap to something else.
    for (let i = 12; i < 16; i++) wrong[i] = 0
    expect(() => pngPixelSize(wrong)).toThrow(/IHDR/)
  })
})

describe('developer dir resolution', () => {
  it('empty/non-absolute selection names the xcode-select repair', () => {
    try {
      developerDirFromSelectOutput('')
      expect.unreachable()
    } catch (error) {
      expect((error as SimulatorError).code).toBe('SIMULATOR_XCODE_NOT_RESOLVED')
      expect((error as Error).message).toContain('xcode-select -s')
    }
    expect(() => developerDirFromSelectOutput('relative/path')).toThrow(SimulatorError)
  })

  it('missing Contents/Developer layout is a distinct stale-selection failure', () => {
    // assertIosDeveloperDir probes the real filesystem; pick paths that do not exist.
    try {
      assertIosDeveloperDir('/definitely/absent/Xcode.app/Contents/Developer')
      expect.unreachable()
    } catch (error) {
      expect((error as SimulatorError).code).toBe('SIMULATOR_XCODE_NOT_RESOLVED')
      expect((error as Error).message).toContain('does not exist on disk')
    }
  })

  it('a directory without the iOS platform demands component installation', () => {
    try {
      assertIosDeveloperDir('/tmp') // exists on macOS/Linux alike; no iPhoneOS.platform inside
      expect.unreachable()
    } catch (error) {
      expect((error as SimulatorError).code).toBe('SIMULATOR_IOS_SDK_MISSING')
      expect((error as Error).message).toContain('iPhoneOS.platform')
    }
  })
})

describe('target resolution', () => {
  const list = parseDeviceList(LIST_JSON)

  it('accepts an explicit known id verbatim', () => {
    expect(resolveSimulatorTarget(list, SimulatorId('AAA-1'))).toEqual(SimulatorId('AAA-1'))
  })

  it('unknown id → DEVICE_NOT_FOUND naming the search hint', () => {
    try {
      resolveSimulatorTarget(list, SimulatorId('NOPE'))
      expect.unreachable()
    } catch (error) {
      expect((error as SimulatorError).code).toBe('SIMULATOR_DEVICE_NOT_FOUND')
      expect((error as Error).message).toContain('sim_list')
    }
  })

  it('no id + no booted device → DEVICE_NOT_BOOTED with the boot hint', () => {
    const shut = list.map(d => ({ ...d, state: 'shutdown' as const }))
    try {
      resolveSimulatorTarget(shut)
      expect.unreachable()
    } catch (error) {
      expect((error as SimulatorError).code).toBe('SIMULATOR_DEVICE_NOT_BOOTED')
      expect((error as Error).message).toContain('Boot one')
    }
  })

  it('no id + several booted devices → TARGET_AMBIGUOUS listing them', () => {
    const both = [...list, ...list].map((d, i) => ({ ...d, id: SimulatorId(`${String(d.id)}-${i}`), state: i % 2 === 1 ? ('booted' as const) : d.state }))
    const bootedTwo = both.filter(d => d.state === 'booted')
    expect(bootedTwo.length).toBeGreaterThanOrEqual(2)
    try {
      resolveSimulatorTarget(bootedTwo)
      expect.unreachable()
    } catch (error) {
      expect((error as SimulatorError).code).toBe('SIMULATOR_TARGET_AMBIGUOUS')
      expect((error as Error).message).toContain('Pass an explicit device id')
    }
  })
})

describe('subcommand allowlist', () => {
  it('covers exactly the phase-1 verbs plus io, and excludes future seams', () => {
    for (const word of ['list', 'boot', 'shutdown', 'install', 'launch', 'terminate', 'openurl', 'io']) {
      expect(SIMCTL_ALLOWLIST.has(word)).toBe(true)
    }
    // The public surface has no input verbs; nothing beyond these may spawn.
    expect([...SIMCTL_ALLOWLIST]).not.toContain('tap')
  })
})
