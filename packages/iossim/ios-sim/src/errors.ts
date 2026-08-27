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

/**
 * The one failure class every simulator verb throws. Route on
 * {@link SimulatorError.code}; `message` carries the user-repair hint.
 */
export class SimulatorError extends HarnessError {}
