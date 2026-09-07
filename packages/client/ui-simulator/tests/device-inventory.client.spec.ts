// The pure inventory derivations behind the device picker: identifier labels,
// grouping by model with booted models first, runtime ordering, and the row
// and chip labels, including the degraded shape an older bridge sends.

import { describe, expect, it } from 'vitest'
import {
  deviceChipLabel, deviceRowLabel, groupDevices, modelLabel, runtimeLabel, type DeviceRow,
} from '../src/client/device-inventory.ts'

const TYPE = (model: string) => `com.apple.CoreSimulator.SimDeviceType.${model}`
const RT = (version: string) => `com.apple.CoreSimulator.SimRuntime.iOS-${version}`

const row = (id: string, name: string, model: string, version: string, state: DeviceRow['state'] = 'shutdown'): DeviceRow => ({
  id, name, state, deviceTypeIdentifier: TYPE(model), runtimeIdentifier: RT(version),
})

describe('labels', () => {
  it('reads platform and dotted version out of a runtime identifier', () => {
    expect(runtimeLabel(RT('26-1'))).toBe('iOS 26.1')
    expect(runtimeLabel('com.apple.CoreSimulator.SimRuntime.tvOS-18-0')).toBe('tvOS 18.0')
    expect(runtimeLabel('rt-17')).toBe('rt 17')
    expect(runtimeLabel('custom')).toBe('custom')
  })

  it('reads the model out of a device-type identifier', () => {
    expect(modelLabel(TYPE('iPhone-17-Pro'))).toBe('iPhone 17 Pro')
    expect(modelLabel('type-a')).toBe('type a')
  })
})

describe('groupDevices', () => {
  it('groups by model, newest runtime first, booted models ahead of the rest', () => {
    const groups = groupDevices([
      row('a', 'iPad Air', 'iPad-Air', '26-0'),
      row('b', 'iPhone 17 Pro', 'iPhone-17-Pro', '26-0'),
      row('c', 'iPhone 17 Pro', 'iPhone-17-Pro', '26-1', 'booted'),
      row('d', 'iPhone 17', 'iPhone-17', '26-1'),
    ])
    expect(groups.map(g => [g.model, g.devices.map(d => d.id)])).toEqual([
      ['iPhone 17 Pro', ['c', 'b']],
      ['iPad Air', ['a']],
      ['iPhone 17', ['d']],
    ])
  })

  it('orders versions numerically per component and lets a booted device win a tie', () => {
    const groups = groupDevices([
      row('old', 'iPhone 17', 'iPhone-17', '9-4'),
      row('new', 'iPhone 17', 'iPhone-17', '26-1'),
      row('mid-off', 'iPhone 17', 'iPhone-17', '26-0'),
      row('mid-on', 'iPhone 17', 'iPhone-17', '26-0', 'booted'),
      row('longer', 'iPhone 17', 'iPhone-17', '26-1-2'),
    ])
    expect(groups[0]?.devices.map(d => d.id)).toEqual(['longer', 'new', 'mid-on', 'mid-off', 'old'])
  })

  it('treats a missing version component as older than any present one, in both insertion orders', () => {
    for (const ids of [['short', 'long'], ['long', 'short']]) {
      const rows = ids.map(id => row(id, 'iPhone 17', 'iPhone-17', id === 'long' ? '26-1-2' : '26-1'))
      expect(groupDevices(rows)[0]?.devices.map(d => d.id)).toEqual(['long', 'short'])
    }
  })

  it('labels a group by the name most of its devices carry, so substrate punctuation survives', () => {
    const groups = groupDevices([
      row('a', 'QA phone', 'iPad-Air-11-inch-M3', '26-1'),
      row('b', 'iPad Air 11-inch (M3)', 'iPad-Air-11-inch-M3', '26-0'),
      row('c', 'iPad Air 11-inch (M3)', 'iPad-Air-11-inch-M3', '18-4'),
      row('d', 'Renamed only', 'iPhone-16e', '26-1'),
    ])
    expect(groups.map(g => g.model)).toEqual(['iPad Air 11-inch (M3)', 'Renamed only'])
    expect(groupDevices([])).toEqual([])
  })

  it('falls back to display names when the bridge sends no identifiers', () => {
    const legacy: DeviceRow[] = [
      { id: 'x', name: 'iPhone 15 Pro', state: 'booted' },
      { id: 'y', name: 'iPhone 15 Pro', state: 'shutdown' },
      { id: 'z', name: 'iPad', state: 'shutdown', runtimeIdentifier: 'weird' },
    ]
    const groups = groupDevices(legacy)
    expect(groups.map(g => [g.key, g.model, g.devices.map(d => d.id)])).toEqual([
      ['iPhone 15 Pro', 'iPhone 15 Pro', ['x', 'y']],
      ['iPad', 'iPad', ['z']],
    ])
  })
})

describe('row and chip labels', () => {
  it('shows the runtime alone for a device named after its model, and the name first when renamed', () => {
    expect(deviceRowLabel(row('a', 'iPhone 17 Pro', 'iPhone-17-Pro', '26-1'), 'iPhone 17 Pro')).toBe('iOS 26.1')
    expect(deviceRowLabel(row('a', 'QA phone', 'iPhone-17-Pro', '26-1'), 'iPhone 17 Pro')).toBe('QA phone · iOS 26.1')
    expect(deviceRowLabel({ id: 'a', name: 'Legacy', state: 'shutdown' }, 'Legacy')).toBe('Legacy')
  })

  it('names the chip by device and runtime', () => {
    expect(deviceChipLabel(row('a', 'iPhone 17 Pro', 'iPhone-17-Pro', '26-1'))).toBe('iPhone 17 Pro · iOS 26.1')
    expect(deviceChipLabel({ id: 'a', name: 'Legacy', state: 'booted' })).toBe('Legacy')
  })
})
