/**
 * Structured failure type for the security-scanning seam. Lives apart from
 * `types.ts` so pure modules can throw it without importing the runtime.
 * @module dsh-security-scan/errors
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'

/** Structured failure of the security-scanning seam; codes carry the SECURITY_ prefix. */
export class SecurityScanError extends HarnessError {}
