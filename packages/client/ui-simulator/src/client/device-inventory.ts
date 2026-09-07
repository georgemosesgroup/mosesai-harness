/**
 * Pure derivations over the bridge's device inventory: human labels for the
 * substrate identifiers and the grouping the picker renders, so the panel
 * component stays a renderer.
 */

/** One device as the bridge's `devices` message carries it. */
export interface DeviceRow {
  id: string
  name: string
  state: 'booted' | 'shutdown'
  /** Substrate product-type identifier (e.g. `com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro`); absent from older bridges. */
  deviceTypeIdentifier?: string
  /** Substrate OS-runtime identifier (e.g. `com.apple.CoreSimulator.SimRuntime.iOS-26-1`); absent from older bridges. */
  runtimeIdentifier?: string
}

/** One picker group: every device of one model, newest runtime first. */
export interface DeviceGroup {
  /** Group key: the device-type identifier, or the display name when the bridge sends none. */
  key: string
  /** The model as the picker names it (`iPhone 17 Pro`). */
  model: string
  devices: readonly DeviceRow[]
}

/** The last dotted segment of a CoreSimulator identifier, or the whole string when it has no dots. */
function lastSegment(identifier: string): string {
  const at = identifier.lastIndexOf('.')
  return at === -1 ? identifier : identifier.slice(at + 1)
}

/**
 * Human label of an OS-runtime identifier: `…SimRuntime.iOS-26-1` reads
 * `iOS 26.1`. The platform is the first dash-separated token; the version
 * tokens rejoin with dots. An identifier without dashes is returned as is.
 * @param identifier - substrate runtime identifier.
 * @returns the display label.
 */
export function runtimeLabel(identifier: string): string {
  const segment = lastSegment(identifier)
  const dash = segment.indexOf('-')
  if (dash === -1) return segment
  return `${segment.slice(0, dash)} ${segment.slice(dash + 1).replaceAll('-', '.')}`
}

/**
 * Human label of a product-type identifier: `…SimDeviceType.iPhone-17-Pro`
 * reads `iPhone 17 Pro`. Dashes become spaces; an identifier without dots
 * is treated as the bare segment.
 * @param identifier - substrate device-type identifier.
 * @returns the display label.
 */
export function modelLabel(identifier: string): string {
  return lastSegment(identifier).replaceAll('-', ' ')
}

/**
 * The version tuple of a runtime label for ordering (`iOS 26.1` → [26, 1]);
 * labels without a numeric version sort last.
 */
function versionOf(row: DeviceRow): number[] {
  if (row.runtimeIdentifier === undefined) return []
  const label = runtimeLabel(row.runtimeIdentifier)
  const version = label.slice(label.indexOf(' ') + 1)
  return version.split('.').map(part => Number.parseInt(part, 10)).filter(part => !Number.isNaN(part))
}

function compareVersionsDesc(a: number[], b: number[]): number {
  const length = Math.max(a.length, b.length)
  for (let index = 0; index < length; index++) {
    const delta = (b[index] ?? -1) - (a[index] ?? -1)
    if (delta !== 0) return delta
  }
  return 0
}

/** The display name most devices of one group carry; the earliest wins a tie. */
function commonName(devices: readonly DeviceRow[]): string {
  const counts = new Map<string, number>()
  let best = ''
  let bestCount = 0
  for (const device of devices) {
    const count = (counts.get(device.name) ?? 0) + 1
    counts.set(device.name, count)
    if (count > bestCount) {
      best = device.name
      bestCount = count
    }
  }
  return best
}

/**
 * Group the inventory by model. Groups holding a booted device come first,
 * then models alphabetically; inside a group the newest runtime leads and a
 * booted device wins a tie. The group key is the device-type identifier (the
 * display name when the bridge sends none); the group's model label is the
 * display name most of its devices carry, because the substrate names a
 * device after its product (`iPad Air 11-inch (M3)`) with punctuation the
 * identifier drops. A device renamed by the operator therefore shows its own
 * name in its row, not in the group label, unless it is the group's only one.
 * @param devices - the inventory as received.
 * @returns the ordered groups.
 */
export function groupDevices(devices: readonly DeviceRow[]): DeviceGroup[] {
  const groups = new Map<string, DeviceRow[]>()
  for (const device of devices) {
    const key = device.deviceTypeIdentifier ?? device.name
    groups.set(key, [...(groups.get(key) ?? []), device])
  }
  const ordered = [...groups.entries()].map(([key, members]) => ({
    key,
    model: commonName(members),
    devices: [...members].sort((a, b) => {
      const byVersion = compareVersionsDesc(versionOf(a), versionOf(b))
      if (byVersion !== 0) return byVersion
      return Number(b.state === 'booted') - Number(a.state === 'booted')
    }),
  }))
  const hasBooted = (group: DeviceGroup): number => Number(group.devices.some(d => d.state === 'booted'))
  return ordered.sort((a, b) => hasBooted(b) - hasBooted(a) || a.model.localeCompare(b.model))
}

/**
 * The line a picker row shows for one device: its runtime, prefixed by the
 * device's own name when the operator named it differently from its model.
 * @param device - the inventory row.
 * @param model - the group's model label.
 * @returns the row label, or the display name when the bridge sends no runtime.
 */
export function deviceRowLabel(device: DeviceRow, model: string): string {
  const runtime = device.runtimeIdentifier === undefined ? undefined : runtimeLabel(device.runtimeIdentifier)
  if (runtime === undefined) return device.name
  return device.name === model ? runtime : `${device.name} · ${runtime}`
}

/**
 * The chip label for a selected device: `iPhone 17 Pro · iOS 26.1`, or the
 * display name alone when the bridge sends no identifiers.
 * @param device - the selected inventory row.
 * @returns the chip label.
 */
export function deviceChipLabel(device: DeviceRow): string {
  const runtime = device.runtimeIdentifier === undefined ? undefined : runtimeLabel(device.runtimeIdentifier)
  return runtime === undefined ? device.name : `${device.name} · ${runtime}`
}
