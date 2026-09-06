/**
 * Failure class of the iOS-simulator seam. Every code names a distinct repair
 * path, so users can tell "fix xcode-select" from "boot the device" without
 * parsing prose ([error policy](../../../../AGENTS.md#type-safety-and-documentation)).
 * @module @deepseek-ai/dsh-ios-sim/errors
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'

/** Stable machine-routing failure codes of the simulator seam. */
export type SimulatorErrorCode =
  /** The provider does not implement (or has not advertised) the called capability. */
  | 'SIMULATOR_CAPABILITY_UNAVAILABLE'
  | 'SIMULATOR_PLATFORM_UNSUPPORTED'
  | 'SIMULATOR_XCODE_NOT_RESOLVED'
  | 'SIMULATOR_IOS_SDK_MISSING'
  | 'SIMULATOR_DEVICE_NOT_FOUND'
  | 'SIMULATOR_DEVICE_NOT_BOOTED'
  | 'SIMULATOR_TARGET_AMBIGUOUS'
  | 'SIMCTL_TIMEOUT'
  | 'SIMCTL_ALLOWLIST_REJECTED'
  | 'SIMCTL_SUBCOMMAND_FAILED'
  | 'SIMCTL_OUTPUT_PARSE_FAILED'
  /** The helper binary behind a native provider is unresolvable or unlaunchable on this host. */
  | 'SIMULATOR_HELPER_UNAVAILABLE'
  /** The helper answered outside the framed protocol (malformed handshake or frame). */
  | 'SIMULATOR_HELPER_PROTOCOL_BROKEN'
  /** The helper died mid-call more often than the provider's restart bound allows. */
  | 'SIMULATOR_HELPER_SUPERVISION_EXHAUSTED'
  /** The helper answered the request with a named substrate failure. */
  | 'SIMULATOR_HELPER_REQUEST_FAILED'
  /** The helper did not answer within the configured deadline. */
  | 'SIMULATOR_HELPER_TIMEOUT'
  /** An element reference is not in the provider's cached describe for this device. */
  | 'SIMULATOR_ELEMENT_REFERENCE_STALE'

/**
 * The one failure class every simulator verb throws. Route on
 * {@link SimulatorError.code}; `message` carries the user-repair hint.
 */
export class SimulatorError extends HarnessError {}

/**
 * Runtime mirror of {@link SimulatorErrorCode} for boundary routing: a
 * substrate that answers in this vocabulary (the helper's error frames) keeps
 * its code verbatim, and anything else is a foreign failure the receiver
 * classifies under its own name.
 */
export const SIMULATOR_ERROR_CODES: ReadonlySet<SimulatorErrorCode> = new Set<SimulatorErrorCode>([
  'SIMULATOR_CAPABILITY_UNAVAILABLE',
  'SIMULATOR_PLATFORM_UNSUPPORTED',
  'SIMULATOR_XCODE_NOT_RESOLVED',
  'SIMULATOR_IOS_SDK_MISSING',
  'SIMULATOR_DEVICE_NOT_FOUND',
  'SIMULATOR_DEVICE_NOT_BOOTED',
  'SIMULATOR_TARGET_AMBIGUOUS',
  'SIMCTL_TIMEOUT',
  'SIMCTL_ALLOWLIST_REJECTED',
  'SIMCTL_SUBCOMMAND_FAILED',
  'SIMCTL_OUTPUT_PARSE_FAILED',
  'SIMULATOR_HELPER_UNAVAILABLE',
  'SIMULATOR_HELPER_PROTOCOL_BROKEN',
  'SIMULATOR_HELPER_SUPERVISION_EXHAUSTED',
  'SIMULATOR_HELPER_REQUEST_FAILED',
  'SIMULATOR_HELPER_TIMEOUT',
  'SIMULATOR_ELEMENT_REFERENCE_STALE',
])
