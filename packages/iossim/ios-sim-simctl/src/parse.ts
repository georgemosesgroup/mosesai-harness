/**
 * Pure parsers for the `xcrun simctl` outputs this provider consumes. Keeping
 * every parser here makes them unit-testable without macOS and gives the
 * provider one reviewable surface where substrate output shape is trusted.
 * @module @deepseek-ai/dsh-ios-sim-simctl/parse
 */

import { SimulatorId } from '@deepseek-ai/dsh-ios-sim'
import type { SimulatorDevice, SimulatorState, SimulatorDeviceCatalog, SimulatorDeviceType, SimulatorRuntime } from '@deepseek-ai/dsh-ios-sim'

/**
 * Parse `xcrun simctl list devices --json` stdout into seam devices.
 * Substrate states richer than the seam's two power states collapse to
 * `'shutdown'` — only `'booted'`/non-booted matters downstream — so a
 * transitional state never drops or misfiles a device.
 *
 * @param stdout - complete raw stdout of the invocation.
 * @returns devices in substrate order.
 * @throws {Error} when the payload is not the expected JSON object shape
 *   (`SIMCTL_OUTPUT_PARSE_FAILED` is raised by the caller that owns codes).
 */
export function parseDeviceList(stdout: string): readonly SimulatorDevice[] {
  const parsed: unknown = JSON.parse(stdout)
  if (typeof parsed !== 'object' || parsed === null) throw new Error('simctl list --json did not return an object')
  const byRuntime = (parsed as { devices?: unknown }).devices
  if (typeof byRuntime !== 'object' || byRuntime === null) throw new Error('simctl list --json carries no devices map')
  const devices: SimulatorDevice[] = []
  for (const [runtimeIdentifier, entries] of Object.entries(byRuntime as Record<string, unknown>)) {
    if (!Array.isArray(entries)) continue
    for (const entry of entries) {
      const record = entry as {
        udid?: unknown
        name?: unknown
        state?: unknown
        deviceTypeIdentifier?: unknown
        isAvailable?: unknown
      }
      if (typeof record.udid !== 'string' || record.udid.length === 0) continue
      // Substrate rows advertise availability as boolean or YES/NO strings across versions.
      const rawAvailability = record.isAvailable
      // Substrate rows advertise availability as boolean or YES/NO strings
      // across versions; the closed unavailable forms are exactly those two.
      const available = !(rawAvailability === false || rawAvailability === 'false' || rawAvailability === 'NO' || rawAvailability === 'no')
      if (!available) continue
      const state: SimulatorState = typeof record.state === 'string' && /^booted$/iu.test(record.state) ? 'booted' : 'shutdown'
      devices.push({
        id: SimulatorId(record.udid),
        name: typeof record.name === 'string' ? record.name : record.udid,
        state,
        deviceTypeIdentifier: typeof record.deviceTypeIdentifier === 'string' ? record.deviceTypeIdentifier : '',
        runtimeIdentifier,
      })
    }
  }
  return devices
}

/** The `<bundleId>: <pid>` tail `simctl launch` prints on success. */
export interface LaunchObservation {
  /** Echoed bundle identifier. */
  bundleId: string
  /** Host-side pid when the substrate printed one. */
  pid: number | undefined
}

/**
 * Parse `simctl launch` output into its bundle id and optional pid.
 * @param stdout - complete raw stdout of the invocation.
 * @param expectedBundleId - the requested bundle identifier (echo check).
 * @returns the observed launch facts.
 * @throws {Error} when no bundle-id line can be recognized.
 */
export function parseLaunchOutput(stdout: string, expectedBundleId: string): LaunchObservation {
  const match = /([A-Za-z0-9.-]+)(?::\s*(\d+))?\s*$/u.exec(stdout.trim())
  if (match === null || match[1] !== expectedBundleId) {
    throw new Error(`launch output did not name ${expectedBundleId}: ${JSON.stringify(stdout.slice(0, 200))}`)
  }
  const pidRaw = match[2]
  return { bundleId: match[1], pid: pidRaw === undefined ? undefined : Number(pidRaw) }
}

/**
 * Read the pixel size out of a PNG raster's IHDR chunk without dependencies:
 * PNG signature (8 bytes), IHDR length+type (8 bytes), then big-endian
 * width/height.
 * @param png - the complete PNG file bytes the substrate wrote.
 * @returns width and height in pixels.
 * @throws {Error} when the bytes are not a well-formed PNG with an IHDR header.
 */
export function pngPixelSize(png: Uint8Array): { widthPx: number; heightPx: number } {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const
  if (png.length < 24 || signature.some((byte, index) => png[index] !== byte)) {
    throw new Error('screenshot bytes are not a PNG image (bad signature)')
  }
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
  const ihdrType = new Uint8Array(png.buffer, png.byteOffset + 12, 4)
  if (!(ihdrType[0] === 73 && ihdrType[1] === 72 && ihdrType[2] === 68 && ihdrType[3] === 82)) {
    throw new Error('screenshot PNG carries no leading IHDR chunk')
  }
  return { widthPx: view.getUint32(16), heightPx: view.getUint32(20) }
}

/**
 * Parse `simctl list devicetypes -j` and `simctl list runtimes -j` into the
 * seam's device-type and runtime catalog. Unavailable runtimes are reported
 * with `available: false` rather than dropped, so the panel can grey them out.
 * @param deviceTypesJson - stdout of `simctl list devicetypes -j`.
 * @param runtimesJson - stdout of `simctl list runtimes -j`.
 * @returns the catalog `create` draws from.
 */
export function parseDeviceCatalog(deviceTypesJson: string, runtimesJson: string): SimulatorDeviceCatalog {
  const dt = JSON.parse(deviceTypesJson) as { devicetypes?: unknown }
  const rt = JSON.parse(runtimesJson) as { runtimes?: unknown }
  const deviceTypes: SimulatorDeviceType[] = []
  for (const entry of Array.isArray(dt.devicetypes) ? dt.devicetypes : []) {
    const record = entry as { identifier?: unknown; name?: unknown }
    if (typeof record.identifier === 'string' && typeof record.name === 'string') {
      deviceTypes.push({ identifier: record.identifier, name: record.name })
    }
  }
  const runtimes: SimulatorRuntime[] = []
  for (const entry of Array.isArray(rt.runtimes) ? rt.runtimes : []) {
    const record = entry as { identifier?: unknown; name?: unknown; isAvailable?: unknown }
    if (typeof record.identifier === 'string' && typeof record.name === 'string') {
      runtimes.push({ identifier: record.identifier, name: record.name, available: record.isAvailable === true })
    }
  }
  return { deviceTypes, runtimes }
}

/**
 * Parse the UDID `simctl create` prints on success (the only line of stdout).
 * @param stdout - stdout of `simctl create <name> <type> <runtime>`.
 * @returns the new device's id.
 * @throws {Error} when stdout carries no UUID-shaped token.
 */
export function parseCreatedDeviceId(stdout: string): SimulatorId {
  const match = /[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}/.exec(stdout)
  if (match === null) throw new Error(`simctl create printed no device UDID: ${JSON.stringify(stdout.slice(0, 120))}`)
  return SimulatorId(match[0])
}
