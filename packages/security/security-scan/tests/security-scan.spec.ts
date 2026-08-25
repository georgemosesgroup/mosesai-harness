import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SecurityScanRuntime, {
  SECURITY_SCANNER_IDS,
  normalizeTarget,
  parseAllowlist,
  parseAllowlistEntry,
  targetAllowed,
} from '@deepseek-ai/dsh-security-scan'
import type {
  SecurityScanProvider,
  SecurityScanRequest,
  SecurityScanResult,
} from '@deepseek-ai/dsh-security-scan'

// ── helpers ──────────────────────────────────────────────────────────────────

function scanResult(request: SecurityScanRequest): SecurityScanResult {
  return {
    scanner: request.scanner,
    argv: ['bin', ...request.targets],
    exitCode: 0,
    signal: null,
    timedOut: false,
    aborted: false,
    durationMs: 5,
    stdout: { text: 'ok', truncated: false },
    stderr: { text: '', truncated: false },
  }
}

function makeProvider(
  id: string,
  scanners: readonly string[],
  scan: (request: SecurityScanRequest) => Promise<SecurityScanResult> = request => Promise.resolve(scanResult(request)),
): SecurityScanProvider {
  return { id, available: scanner => scanners.includes(scanner), scan }
}

async function mount(
  config: Partial<ConstructorParameters<typeof SecurityScanRuntime>[1]> & { allowlist: readonly string[] },
): Promise<{ ctx: Context; runtime: SecurityScanRuntime }> {
  const ctx = new Context()
  await ctx.plugin(SecurityScanRuntime, { maxTargetsPerScan: 8, ...config })
  return { ctx, runtime: ctx.securityScan }
}

// ── allowlist entry parsing ──────────────────────────────────────────────────

describe('parseAllowlistEntry', () => {
  it('accepts exact hosts, wildcard domains, IPs, and CIDRs', () => {
    expect(parseAllowlistEntry('Example.COM')).toEqual({ kind: 'exact', host: 'example.com' })
    expect(parseAllowlistEntry('.example.com')).toEqual({ kind: 'wildcard-domain', base: 'example.com' })
    expect(parseAllowlistEntry('127.0.0.1')).toEqual({ kind: 'exact', host: '127.0.0.1' })
    expect(parseAllowlistEntry('2001:db8::1')).toEqual({ kind: 'exact', host: '2001:db8::1' })
    const cidr4 = parseAllowlistEntry('10.0.0.0/24')
    expect(cidrV4Prefix(cidr4)).toBe(24)
    expect(parseAllowlistEntry('2001:db8::/32').kind).toBe('cidr')
  })

  it('rejects non-canonical and out-of-range CIDR', () => {
    expect(() => parseAllowlistEntry('10.0.0.5/24')).toThrowSecurityCode('SECURITY_ALLOWLIST_ENTRY_INVALID')
    expect(() => parseAllowlistEntry('10.0.0.0/33')).toThrowSecurityCode('SECURITY_ALLOWLIST_ENTRY_INVALID')
    expect(() => parseAllowlistEntry('2001:db8::1/32')).toThrowSecurityCode('SECURITY_ALLOWLIST_ENTRY_INVALID')
    expect(() => parseAllowlistEntry('2001:db8::/129')).toThrowSecurityCode('SECURITY_ALLOWLIST_ENTRY_INVALID')
  })

  it('rejects malformed entries', () => {
    for (const bad of ['', ' ', '*.example.com', 'example.com/path', 'a b.test', 'exa_mple.com', '-x.test', 'x-.test', 'foo::bar::baz', '[::1', 'user@example.com']) {
      expect(() => parseAllowlistEntry(bad), bad).toThrow()
    }
  })
})

function cidrV4Prefix(entry: ReturnType<typeof parseAllowlistEntry>): number {
  if (entry.kind !== 'cidr') throw new Error('expected cidr')
  return entry.prefix
}

expect.extend({
  toThrowSecurityCode(received: () => unknown, code: string) {
    let thrown: unknown
    try {
      received()
    } catch (error) {
      thrown = error
    }
    const pass = thrown instanceof Error && (thrown as { code?: string }).code === code
    return { pass, message: () => `expected function to throw ${code}, got ${String(thrown)}` }
  },
})

declare module 'vitest' {
  interface Assertion<T> {
    toThrowSecurityCode(code: string): T
  }
}

// ── whole-list parsing ───────────────────────────────────────────────────────

describe('parseAllowlist', () => {
  it('throws ALLOWLIST_EMPTY for an empty list', () => {
    expect(() => parseAllowlist([])).toThrowSecurityCode('SECURITY_ALLOWLIST_EMPTY')
  })

  it('names the offending element index', () => {
    try {
      parseAllowlist(['stub.test', '10.0.0.5/24'])
      expect.unreachable()
    } catch (error) {
      expect(error).toMatchObject({ code: 'SECURITY_ALLOWLIST_ENTRY_INVALID' })
      expect((error as Error).message).toContain('#1')
    }
  })
})

// ── target normalization ─────────────────────────────────────────────────────

describe('normalizeTarget', () => {
  it('strips scheme, port, brackets, trailing dot; lowercases', () => {
    expect(normalizeTarget('https://Stub.Test:8443/path?q=1')).toBe('stub.test')
    expect(normalizeTarget('http://[2001:DB8::1]:8080/')).toBe('2001:db8::1')
    expect(normalizeTarget('example.com.')).toBe('example.com')
    expect(normalizeTarget('EXAMPLE.com:993')).toBe('example.com')
  })

  it('keeps bare IPv6 without brackets and strips ports only after ] or single colon', () => {
    expect(normalizeTarget('::1')).toBe('::1')
    expect(normalizeTarget('[::1]:22')).toBe('::1')
  })

  it('rejects userinfo and garbage', () => {
    for (const bad of ['user@stub.test', 'https://u:p@stub.test/', '', '   ', 'a:b', '[::1', 'https://u:p@stub.test']) {
      expect(() => normalizeTarget(bad), bad).toThrowSecurityCode('SECURITY_TARGET_INVALID')
    }
  })
})

// ── matching ─────────────────────────────────────────────────────────────────

describe('targetAllowed', () => {
  const list = parseAllowlist([
    'exact.test',
    '.wide.test',
    '127.0.0.1',
    '10.0.0.0/24',
    '::1',
    '2001:db8::/32',
  ])

  it('exact host does not cover subdomains', () => {
    expect(targetAllowed(list, 'exact.test')).toBe(true)
    expect(targetAllowed(list, 'sub.exact.test')).toBe(false)
    expect(targetAllowed(list, 'notexact.test')).toBe(false)
  })

  it('.domain covers apex and any depth, nothing else', () => {
    expect(targetAllowed(list, 'wide.test')).toBe(true)
    expect(targetAllowed(list, 'a.b.wide.test')).toBe(true)
    expect(targetAllowed(list, 'widest.test')).toBe(false)
    expect(targetAllowed(list, 'wide.test.evil.io')).toBe(false)
  })

  it('CIDRv4 covers range bounds including network address', () => {
    expect(targetAllowed(list, '10.0.0.0')).toBe(true)
    expect(targetAllowed(list, '10.0.0.255')).toBe(true)
    expect(targetAllowed(list, '10.0.1.0')).toBe(false)
  })

  it('/32 and /0 behave as point and match-all', () => {
    const point = parseAllowlist(['10.9.9.7/32'])
    expect(targetAllowed(point, '10.9.9.7')).toBe(true)
    expect(targetAllowed(point, '10.9.9.8')).toBe(false)
    const all = parseAllowlist(['0.0.0.0/0'])
    expect(targetAllowed(all, '203.0.113.9')).toBe(true)
  })

  it('IPv6 literal exact and CIDRv6 boundaries', () => {
    expect(targetAllowed(list, '::1')).toBe(true)
    expect(targetAllowed(list, '::2')).toBe(false)
    expect(targetAllowed(list, '2001:db8::1')).toBe(true)
    expect(targetAllowed(list, '2001:db8:1::1')).toBe(true)
    expect(targetAllowed(list, '2001:db9::1')).toBe(false)
  })

  it('port never participates: allowed host allowed on any port', () => {
    const scoped = parseAllowlist(['stub.test'])
    expect(targetAllowed(scoped, normalizeTarget('http://stub.test:1234'))).toBe(true)
  })
})

// ── runtime selection and enforcement ────────────────────────────────────────

describe('SecurityScanRuntime', () => {
  it('rejects an empty allowlist at construction', async () => {
    const ctx = new Context()
    await expect(ctx.plugin(SecurityScanRuntime, { allowlist: [] })).rejects.toMatchObject({
      code: 'SECURITY_ALLOWLIST_EMPTY',
    })
  })

  it('rejects duplicate provider ids', async () => {
    const { runtime } = await mount({ allowlist: ['stub.test'] })
    runtime.registerProvider(makeProvider('dup', SECURITY_SCANNER_IDS))
    expect(() => runtime.registerProvider(makeProvider('dup', SECURITY_SCANNER_IDS)))
      .toThrowSecurityCode('SECURITY_DUPLICATE_PROVIDER')
  })

  it('unregistering a provider makes the seam unavailable again (disposal)', async () => {
    const { runtime } = await mount({ allowlist: ['stub.test'] })
    const dispose = runtime.registerProvider(makeProvider('only', ['nuclei']))
    dispose()
    await expect(runtime.scan({ scanner: 'nuclei', targets: ['https://stub.test/'] }))
      .rejects.toMatchObject({ code: 'SECURITY_PROVIDER_UNAVAILABLE' })
  })

  it('selection: configured missing / configured unavailable / configured wins', async () => {
    const configuredMissing = await mount({ allowlist: ['stub.test'], provider: 'ghost' })
    await expect(configuredMissing.runtime.scan({ scanner: 'nuclei', targets: ['stub.test'] }))
      .rejects.toMatchObject({ code: 'SECURITY_PROVIDER_CONFIGURED_MISSING' })

    const { runtime } = await mount({ allowlist: ['stub.test'], provider: 'sleepy' })
    runtime.registerProvider(makeProvider('sleepy', ['katana']))
    await expect(runtime.scan({ scanner: 'nuclei', targets: ['stub.test'] }))
      .rejects.toMatchObject({ code: 'SECURITY_PROVIDER_CONFIGURED_UNAVAILABLE' })

    const pinned = await mount({ allowlist: ['stub.test'], provider: 'first' })
    const second = makeProvider('second', ['nuclei'])
    const firstSpy = vi.fn((request: SecurityScanRequest) => Promise.resolve(scanResult(request)))
    pinned.runtime.registerProvider({ id: 'first', available: () => true, scan: firstSpy })
    pinned.runtime.registerProvider(second)
    await pinned.runtime.scan({ scanner: 'nuclei', targets: ['stub.test'] })
    expect(firstSpy).toHaveBeenCalledTimes(1)
  })

  it('selection: ambiguous when several usable, single when exactly one', async () => {
    const ambiguous = await mount({ allowlist: ['stub.test'] })
    ambiguous.runtime.registerProvider(makeProvider('a', ['nuclei']))
    ambiguous.runtime.registerProvider(makeProvider('b', ['nuclei']))
    await expect(ambiguous.runtime.scan({ scanner: 'nuclei', targets: ['stub.test'] }))
      .rejects.toMatchObject({ code: 'SECURITY_PROVIDER_AMBIGUOUS' })

    const single = await mount({ allowlist: ['stub.test'] })
    single.runtime.registerProvider(makeProvider('only', ['httpx']))
    await expect(single.runtime.scan({ scanner: 'httpx', targets: ['stub.test'] })).resolves.toMatchObject({
      scanner: 'httpx',
    })
  })

  it('enforces the allowlist BEFORE any provider runs (spy stays cold)', async () => {
    const { runtime } = await mount({ allowlist: ['stub.test'] })
    const scanSpy = vi.fn((request: SecurityScanRequest) => Promise.resolve(scanResult(request)))
    runtime.registerProvider({ id: 'spy', available: () => true, scan: scanSpy })
    await expect(runtime.scan({ scanner: 'nuclei', targets: ['https://evil.example.net/'] }))
      .rejects.toMatchObject({ code: 'SECURITY_TARGET_NOT_ALLOWLISTED' })
    expect(scanSpy).not.toHaveBeenCalled()
  })

  it('normalizes and dedupes targets preserving order; empty list is invalid', async () => {
    const { runtime } = await mount({ allowlist: ['.deep.test'] })
    const scanSpy = vi.fn((request: SecurityScanRequest) => Promise.resolve(scanResult(request)))
    runtime.registerProvider({ id: 'spy', available: () => true, scan: scanSpy })
    await runtime.scan({
      scanner: 'nuclei',
      targets: ['http://A.Deep.test:80/a', 'b.deep.test', 'http://a.deep.test/b'],
    })
    expect(scanSpy.mock.calls[0]?.[0].targets).toEqual(['a.deep.test', 'b.deep.test'])

    await expect(runtime.scan({ scanner: 'nuclei', targets: [] }))
      .rejects.toMatchObject({ code: 'SECURITY_TARGET_INVALID' })
  })

  it('bounds targets per scan', async () => {
    const { runtime } = await mount({ allowlist: ['.many.test'], maxTargetsPerScan: 3 })
    runtime.registerProvider(makeProvider('p', ['nuclei']))
    const nine = Array.from({ length: 9 }, (_, index) => `h${index}.many.test`)
    await expect(runtime.scan({ scanner: 'nuclei', targets: nine.slice(0, 3) })).resolves.toBeDefined()
    await expect(runtime.scan({ scanner: 'nuclei', targets: nine.slice(0, 4) }))
      .rejects.toMatchObject({ code: 'SECURITY_TOO_MANY_TARGETS' })
  })

  it('forwards the cancellation signal to the provider', async () => {
    const { runtime } = await mount({ allowlist: ['stub.test'] })
    const controller = new AbortController()
    const seen: AbortSignal[] = []
    runtime.registerProvider({
      id: 'signal-catcher',
      available: () => true,
      scan: (request: SecurityScanRequest, signal?: AbortSignal) => {
        seen.push(signal ?? new AbortController().signal)
        return Promise.resolve(scanResult(request))
      },
    })
    await runtime.scan({ scanner: 'nmap', targets: ['stub.test'] }, controller.signal)
    expect(seen[0]).toBe(controller.signal)
  })
})
