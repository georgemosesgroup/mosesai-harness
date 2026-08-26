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
import { parseAllowlist, normalizeTarget, targetAllowed, type AllowlistEntry } from './allowlist.ts'
import type {
  SecurityScanProvider,
  SecurityScanRequest,
  SecurityScanResult,
} from './types.ts'
import { SecurityScanError } from './errors.ts'

export { SecurityScanError } from './errors.ts'
export type {
  ScanOutput,
  SecurityScanOptionValue,
  SecurityScanProvider,
  SecurityScanRequest,
  SecurityScanResult,
  SecurityScannerId,
} from './types.ts'
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
export class SecurityScanRuntime extends Service {
  static Config: z<SecurityScanRuntimeConfig> = z.object({
    allowlist: z.array(z.string()),
    maxTargetsPerScan: z.number().default(8),
    provider: z.string(),
  })

  private readonly providers = new Map<string, SecurityScanProvider>()
  private readonly allowlist: readonly AllowlistEntry[]
  private readonly maxTargetsPerScan: number
  private readonly configuredId: string | undefined

  constructor(ctx: Context, config: SecurityScanRuntimeConfig) {
    super(ctx, 'securityScan')
    // Misconfiguration fails loud at load: an empty or malformed allowlist is a
    // composition bug, not a per-call condition.
    this.allowlist = parseAllowlist(config.allowlist)
    this.maxTargetsPerScan = config.maxTargetsPerScan ?? 8
    this.configuredId = config.provider
  }

  /**
   * Register one provider. Throws {@link SecurityScanError}
   * `SECURITY_DUPLICATE_PROVIDER` when its id is already registered.
   * @param provider - the provider; its `id` is the registry key.
   * @returns the disposer that unregisters the provider with the calling fiber.
   */
  registerProvider(provider: SecurityScanProvider): () => void {
    if (this.providers.has(provider.id)) {
      throw new SecurityScanError(
        `a security-scan provider with id "${provider.id}" is already registered`,
        'SECURITY_DUPLICATE_PROVIDER',
      )
    }
    const store = this.providers
    const dispose = this.ctx.effect(function* () {
      store.set(provider.id, provider)
      yield () => {
        store.delete(provider.id)
      }
    }, 'securityScan.registerProvider()')
    return () => void dispose()
  }

  /**
   * Run one scan against allowlisted targets through the selected provider.
   * @param request - scanner, targets, and whitelisted options.
   * @param signal - optional cancellation forwarded to the provider.
   * @returns the provider's settled scan result.
   */
  async scan(request: SecurityScanRequest, signal?: AbortSignal): Promise<SecurityScanResult> {
    const targets = this.authorizeTargets(request.targets)
    const provider = this.resolveProvider(request.scanner)
    return provider.scan({ ...request, targets }, signal)
  }

  /** Normalize, dedupe, bound, and allowlist-check the requested targets. */
  private authorizeTargets(targets: readonly string[]): readonly string[] {
    const normalized: string[] = []
    const seen = new Set<string>()
    for (const raw of targets) {
      const host = normalizeTarget(raw)
      if (!seen.has(host)) {
        seen.add(host)
        normalized.push(host)
      }
    }
    if (normalized.length === 0) {
      throw new SecurityScanError('scan requires at least one target', 'SECURITY_TARGET_INVALID')
    }
    if (normalized.length > this.maxTargetsPerScan) {
      throw new SecurityScanError(
        `scan accepts at most ${this.maxTargetsPerScan} targets, got ${normalized.length}`,
        'SECURITY_TOO_MANY_TARGETS',
      )
    }
    for (const host of normalized) {
      if (!targetAllowed(this.allowlist, host)) {
        throw new SecurityScanError(
          `target "${host}" is not on this deployment's authorized allowlist`,
          'SECURITY_TARGET_NOT_ALLOWLISTED',
        )
      }
    }
    return normalized
  }

  /** Resolve the provider for one scanner following the `ctx.web` selection rules. */
  private resolveProvider(scanner: SecurityScanRequest['scanner']): SecurityScanProvider {
    const usableForScanner = (provider: SecurityScanProvider): boolean => provider.available(scanner)
    if (this.configuredId !== undefined) {
      const provider = this.providers.get(this.configuredId)
      if (provider === undefined) {
        throw new SecurityScanError(
          `configured security-scan provider "${this.configuredId}" is not registered`,
          'SECURITY_PROVIDER_CONFIGURED_MISSING',
        )
      }
      if (!usableForScanner(provider)) {
        throw new SecurityScanError(
          `configured security-scan provider "${this.configuredId}" cannot run scanner "${scanner}" here`,
          'SECURITY_PROVIDER_CONFIGURED_UNAVAILABLE',
        )
      }
      return provider
    }
    const usable = [...this.providers.values()].filter(usableForScanner)
    const [single] = usable
    if (single === undefined) {
      throw new SecurityScanError(
        `no registered provider can run scanner "${scanner}" here`,
        'SECURITY_PROVIDER_UNAVAILABLE',
      )
    }
    if (usable.length > 1) {
      const ids = usable.map(provider => provider.id).join(', ')
      throw new SecurityScanError(
        `multiple providers can run scanner "${scanner}" (${ids}); configure "provider" explicitly`,
        'SECURITY_PROVIDER_AMBIGUOUS',
      )
    }
    return single
  }
}

export default SecurityScanRuntime
