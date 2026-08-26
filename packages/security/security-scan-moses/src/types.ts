/**
 * Vocabulary for the security-scanning capability seam (`ctx.securityScan`):
 * scanner identities, scan requests and results, and the provider contract.
 * Runtime classes live in `index.ts`; this module stays type-only.
 * @module dsh-security-scan/types
 */

/** The external CLI scanners this seam can drive. */
export type SecurityScannerId = 'nuclei' | 'httpx' | 'katana' | 'ffuf' | 'nmap' | 'sqlmap'

/** Every scanner id, in registration-stable order. */
export const SECURITY_SCANNER_IDS: readonly SecurityScannerId[] = [
  'nuclei',
  'httpx',
  'katana',
  'ffuf',
  'nmap',
  'sqlmap',
]

/** Option values the model may pass; arrays render as comma-joined flags. */
export type SecurityScanOptionValue = string | number | boolean | readonly string[]

/** One scan request after tool-layer validation. */
export interface SecurityScanRequest {
  /** Which scanner to run. */
  readonly scanner: SecurityScannerId
  /** Authorized target URLs or host[:port] strings; allowlist-checked by the runtime. */
  readonly targets: readonly string[]
  /** Scanner-specific options from the provider's whitelist (never raw argv). */
  readonly options?: Readonly<Record<string, SecurityScanOptionValue>>
  /**
   * Directory the scan runs in — the calling agent's workspace.
   *
   * A relative path in an option (`-t ./templates/mine.yaml`, a wordlist) is
   * resolved by the scanner against its working directory, so that directory
   * has to be the project the caller is working in. Without it a scan resolves
   * paths against wherever the host process happens to have been started,
   * which is the harness checkout and never what the caller meant.
   */
  readonly cwd?: string
}

/** One captured output stream, structurally compatible with subprocess CollectedOutput. */
export interface ScanOutput {
  /** Retained text — the tail of the stream when truncated. */
  readonly text: string
  /** True when bytes were dropped from `text`. */
  readonly truncated: boolean
  /** Path to a file holding the COMPLETE stream, when truncated and spilled. */
  readonly spillPath?: string
}

/** The settled outcome of one scan run. `argv` carries no secrets by construction. */
export interface SecurityScanResult {
  /** The scanner that ran. */
  readonly scanner: SecurityScannerId
  /** The exact argv executed (binary path plus whitelisted flags and targets). */
  readonly argv: readonly string[]
  /** Exit code; null when the process died from a signal. */
  readonly exitCode: number | null
  /** Terminating signal, when the process died from one. */
  readonly signal: NodeJS.Signals | null
  /** True when THIS provider's deadline fired first. */
  readonly timedOut: boolean
  /** True when an outer cancellation aborted the run before its deadline. */
  readonly aborted: boolean
  /** Wall-clock duration of the run in milliseconds. */
  readonly durationMs: number
  /** Captured stdout. */
  readonly stdout: ScanOutput
  /** Captured stderr. */
  readonly stderr: ScanOutput
}

/** One implementation of the scanning mechanism behind `ctx.securityScan`. */
export interface SecurityScanProvider {
  /** Registry key for this provider. */
  readonly id: string
  /**
   * Cheap local check that `scanner` can actually run here (its binary
   * resolves). No network, no spawn.
   */
  available(scanner: SecurityScannerId): boolean
  /** Run one scan; the runtime has already enforced the target allowlist. */
  scan(request: SecurityScanRequest, signal?: AbortSignal): Promise<SecurityScanResult>
}
