/**
 * Mapping from the helper's describe result (the framework's own serialized
 * element form) to the seam's typed vocabulary. Element references are
 * derived here — the framework names no stable cross-read identity, so the
 * provider mints index-path references that are stable within one result.
 * @module @deepseek-ai/dsh-ios-sim-native/describe
 */

import { SimulatorError, SimulatorId } from '@deepseek-ai/dsh-ios-sim'
import type {
  SimulatorAccessibilityElement,
  SimulatorDescribeResult,
  SimulatorElementFrame,
  SimulatorInputResult,
  SimulatorPoint,
} from '@deepseek-ai/dsh-ios-sim'

/**
 * Map one helper describe result to the seam's type.
 * @param raw - the helper's `result` object.
 * @returns the typed describe result.
 * @throws {SimulatorError} code `SIMULATOR_HELPER_PROTOCOL_BROKEN` when the
 *   payload is not the documented shape — a mixed helper, not a caller error.
 */
export function describeResultFromHelper(raw: Record<string, unknown>): SimulatorDescribeResult {
  const simulatorId = raw.simulatorId
  if (typeof simulatorId !== 'string' || simulatorId.length === 0) {
    throw protocolBroken(`describe result carries no usable simulatorId: ${JSON.stringify(simulatorId)}`)
  }
  if (typeof raw.truncated !== 'boolean') {
    throw protocolBroken(`describe result carries no boolean truncated: ${JSON.stringify(raw.truncated)}`)
  }
  return {
    simulatorId: SimulatorId(simulatorId),
    root: raw.root === undefined || raw.root === null ? null : elementFromHelper(raw.root, '0'),
    screen: screenFromHelper(raw.screen),
    truncated: raw.truncated,
  }
}

/** Recursive element mapping; a non-object payload is a protocol breach. */
function elementFromHelper(value: unknown, reference: string): SimulatorAccessibilityElement {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw protocolBroken(`helper element at reference "${reference}" is not an object: ${JSON.stringify(value)}`)
  }
  const dict = value as Record<string, unknown>
  const rawChildren = Array.isArray(dict.children) ? dict.children : []
  // Null children are skipped and references stay compact: the walk mints
  // each surviving child's index path from its position AFTER filtering.
  const children: SimulatorAccessibilityElement[] = []
  for (const child of rawChildren) {
    if (child === undefined || child === null) continue
    children.push(elementFromHelper(child, `${reference}.${children.length}`))
  }
  return {
    reference,
    identifier: optionalString(dict.identifier),
    role: optionalString(dict.type) ?? 'Unknown',
    label: optionalString(dict.label),
    frame: frameFromHelper(dict.frame),
    // An absent or null `enabled` attests nothing the seam can call
    // interactable, so it maps to false rather than to a guessed true.
    enabled: dict.enabled === true,
    children,
  }
}

/** A frame only exists when every edge is a finite number. */
function frameFromHelper(value: unknown): SimulatorElementFrame | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const dict = value as Record<string, unknown>
  const edges = [dict.x, dict.y, dict.width, dict.height]
  if (!edges.every(edge => typeof edge === 'number' && Number.isFinite(edge))) return undefined
  // The every() guard above proves the numeric tuple; the casts name it.
  return {
    xPoints: dict.x as number,
    yPoints: dict.y as number,
    widthPoints: dict.width as number,
    heightPoints: dict.height as number,
  }
}

/** Screen points only when both dimensions are finite numbers. */
function screenFromHelper(value: unknown): SimulatorDescribeResult['screen'] {
  if (typeof value !== 'object' || value === null) return undefined
  const dict = value as Record<string, unknown>
  const { width, height } = dict
  if (typeof width !== 'number' || !Number.isFinite(width) || typeof height !== 'number' || !Number.isFinite(height)) {
    return undefined
  }
  return { widthPoints: width, heightPoints: height }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function protocolBroken(message: string): SimulatorError {
  return new SimulatorError(`iossim-helper describe result is not the documented protocol shape: ${message}`, 'SIMULATOR_HELPER_PROTOCOL_BROKEN')
}

/** Map one helper input result to the seam's type; the landing point comes from the resolved target. */
export function inputResultFromHelper(raw: Record<string, unknown>, point: SimulatorPoint | undefined): SimulatorInputResult {
  const simulatorId = raw.simulatorId
  if (typeof simulatorId !== 'string' || simulatorId.length === 0) {
    throw protocolBroken(`input result carries no usable simulatorId: ${JSON.stringify(simulatorId)}`)
  }
  return { simulatorId: SimulatorId(simulatorId), actedAt: point }
}

/**
 * Index one describe result's references to the device point each element's
 * frame centre sits at — the lookup an element-target input resolves against.
 * An element without a frame has no centre and indexes nothing.
 */
export function referenceIndexFor(result: SimulatorDescribeResult): { device: string; centres: Map<string, SimulatorPoint> } {
  const centres = new Map<string, SimulatorPoint>()
  const walk = (element: SimulatorAccessibilityElement): void => {
    if (element.frame !== undefined) {
      centres.set(element.reference, {
        xPoints: element.frame.xPoints + element.frame.widthPoints / 2,
        yPoints: element.frame.yPoints + element.frame.heightPoints / 2,
      })
    }
    for (const child of element.children) walk(child)
  }
  if (result.root !== null) walk(result.root)
  return { device: String(result.simulatorId), centres }
}
