/**
 * Type vocabulary for the local security-scanning provider: option rules,
 * target placement, and the pure argv-planning contract shared by the
 * whitelist tables and the executor.
 * @module dsh-security-scan-local/types
 */

import type { SecurityScanOptionValue } from '@deepseek-ai/dsh-security-scan-moses'

/**
 * How a scanner consumes its targets. `positional` scanners take them as
 * trailing arguments; `-u` scanners take exactly one via that flag; `none`
 * scanners are driven entirely by options (ffuf's `url` carries `FUZZ`).
 */
export interface TargetPlacement {
  readonly mode: 'positional' | 'u-flag' | 'none'
}

/** One whitelisted option: its CLI flag and the value rule it accepts. */
export type OptionRule =
  | { readonly kind: 'string'; readonly flag: string; readonly requiresFuzz?: true }
  | { readonly kind: 'int'; readonly flag: string; readonly min?: number; readonly max?: number }
  | { readonly kind: 'boolean'; readonly flag: string }
  | { readonly kind: 'csv'; readonly flag: string; readonly values?: readonly string[] }

/** Whitelist for one scanner: option name → rule, plus defaults applied when the model omits them. */
export interface ScannerSpec {
  /** How targets reach the command line. */
  readonly targets: TargetPlacement
  /** Option whitelist; anything outside is SECURITY_OPTION_UNKNOWN. */
  readonly options: Readonly<Record<string, OptionRule>>
  /** Options injected when the model omits them (nuclei -json/-exclude-tags). */
  readonly defaults?: Readonly<Record<string, SecurityScanOptionValue>>
}

/**
 * Pure argv plan for one scan: flags after the binary path, positional targets
 * where the placement mode calls for them, and nothing else — no passthrough.
 */
export interface ScanArgvPlan {
  /** Flags in CLI form (each value as its own argv entry where the flag takes one). */
  readonly flags: readonly string[]
  /** Trailing positional targets, when the scanner's placement mode uses them. */
  readonly positionalTargets: readonly string[]
}
