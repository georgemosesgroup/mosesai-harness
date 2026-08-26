/**
 * Service Definition for the security-scanning capability seam (`ctx.securityScan`):
 * the provider registry plus the ENFORCED target allowlist. Providers never see
 * a target the allowlist did not authorize — enforcement lives here, in the
 * operation that accepts the targets, so direct service callers cannot bypass
 * it. Provider selection mirrors `ctx.web`: configured id first (missing /
 * unavailable are distinct errors), otherwise exactly one usable provider,
 * else ambiguous or unavailable.
 *
 * @module @deepseek-ai/dsh-security-scan
 */
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { SecurityScanProvider, SecurityScanRequest, SecurityScanResult } from './types.ts'
export { SecurityScanError } from './errors.ts'
export type { ScanOutput, SecurityScanOptionValue, SecurityScanProvider, SecurityScanRequest, SecurityScanResult, SecurityScannerId } from './types.ts'
export { SECURITY_SCANNER_IDS } from './types.ts'
export { normalizeTarget, parseAllowlist, parseAllowlistEntry, parseIpv6, targetAllowed } from './allowlist.ts'
export type { AllowlistEntry } from './allowlist.ts'
declare module '@deepseek-ai/cordis' {
  interface Context {
    securityScan: SecurityScanRuntime
  }
}
/** Runtime config. The allowlist is REQUIRED — an empty list is a load failure. */
export interface SecurityScanRuntimeConfig {
  /** Authorized targets (hosts, `.domain`, IP literals, CIDR). See the README for semantics. */
  allowlist: string[]
  /** Upper bound on targets accepted by one scan call. Defaults to 8. */
  maxTargetsPerScan?: number
  /**
     * Pin one provider id. Omitted = auto-select when exactly one registered
     * provider is usable for the requested scanner.
     */
  provider?: string
}
/** The security-scanning service, registered as `ctx.securityScan`. */
export declare class SecurityScanRuntime extends Service {
  static Config: z<SecurityScanRuntimeConfig>
  private readonly providers
  private readonly allowlist
  private readonly maxTargetsPerScan
  private readonly configuredId
  constructor(ctx: Context, config: SecurityScanRuntimeConfig)
  /**
     * Register one provider. Throws {@link SecurityScanError}
     * `SECURITY_DUPLICATE_PROVIDER` when its id is already registered.
     * @param provider - the provider; its `id` is the registry key.
     * @returns the disposer that unregisters the provider with the calling fiber.
     */
  registerProvider(provider: SecurityScanProvider): () => void
  /**
     * Run one scan against allowlisted targets through the selected provider.
     * @param request - scanner, targets, and whitelisted options.
     * @param signal - optional cancellation forwarded to the provider.
     * @returns the provider's settled scan result.
     */
  scan(request: SecurityScanRequest, signal?: AbortSignal): Promise<SecurityScanResult>
  /** Normalize, dedupe, bound, and allowlist-check the requested targets. */
  private authorizeTargets
  /** Resolve the provider for one scanner following the `ctx.web` selection rules. */
  private resolveProvider
}
export default SecurityScanRuntime
//# sourceMappingURL=index.d.ts.map
