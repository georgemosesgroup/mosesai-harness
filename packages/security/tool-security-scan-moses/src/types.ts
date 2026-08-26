/**
 * Type vocabulary for the security_scan tool: the replayable presentation meta
 * payload shared by `presentationMeta` and `presentResult`.
 * @module dsh-tool-security-scan/types
 */

import type { SecurityScannerId } from '@deepseek-ai/dsh-security-scan-moses'

/** The `security_scan` tool's private `tool/result` meta payload. */
export interface SecurityScanMeta {
  /** The scanner that ran. */
  scanner: SecurityScannerId
  /** How many allowlisted targets the scan covered. */
  targetCount: number
  /** Exit code; null when the process died from a signal or never ran to exit. */
  exitCode: number | null
  /** Whether the model-facing output text was truncated by the output cap. */
  outputTruncated: boolean
}
