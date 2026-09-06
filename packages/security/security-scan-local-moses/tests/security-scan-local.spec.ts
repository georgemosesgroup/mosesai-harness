import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, chmodSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import SecurityScanRuntime, { SecurityScanError } from '@deepseek-ai/dsh-security-scan-moses'
import type { SecurityScanProvider, SecurityScanRequest, SecurityScannerId } from '@deepseek-ai/dsh-security-scan-moses'
import { LocalSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-local'
import { Config, LocalSecurityScanProvider, assertServiceableConfig, findOnPath } from '../src/index.ts'
import { planScanArgv } from '../src/scanners.ts'

const BIN = join(__dirname, 'fixtures', 'bin', 'scanner-stub')
const NO_SHEBANG = join(__dirname, 'fixtures', 'bin', 'no-shebang')
const ALL_SCANNERS = Object.fromEntries(
  (['nuclei', 'httpx', 'katana', 'ffuf', 'nmap', 'sqlmap'] as const).map(id => [id, BIN]),
) as Record<SecurityScannerId, string>

// One shared scratch area per file run: wordlists and PATH-shim directories.
let scratch: string

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'security-scan-local-'))
})

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

/** Complete config shape after defaults, with optional binPaths for PATH-mode tests. */
type LocalResolvedConfig = Required<Omit<Config, 'binPaths'>> & Pick<Config, 'binPaths'>

/** Full resolved config over the stub binary; tests override slices. */
function baseConfig(overrides: Partial<LocalResolvedConfig> = {}): LocalResolvedConfig {
  return {
    binPaths: { ...ALL_SCANNERS },
    wordlistDirs: [scratch],
    cwd: scratch,
    timeoutMs: 10_000,
    maxTimeoutMs: 60_000,
    maxOutputBytes: 64_000,
    maxSpillBytes: 4 * 1024 * 1024,
    graceMs: 100,
    ...overrides,
  }
}

async function mountLocal(configOverrides: Record<string, unknown> = {}): Promise<SecurityScanProvider> {
  const ctx = new Context()
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(SecurityScanRuntime, { allowlist: ['stub.test', '.auth.test', '127.0.0.1'] })
  const provider = new LocalSecurityScanProvider(ctx, baseConfig(configOverrides))
  ctx.securityScan.registerProvider(provider)
  return provider
}

const ENV_STUB = (env: Record<string, string>): Record<string, string | undefined> => env

describe('planScanArgv (pure whitelist)', () => {
  const resolve = (raw: string): string => raw === 'missing.txt' ? raw : `/wl/${raw}`

  it('nuclei: defaults + supplied options, positional targets', () => {
    const plan = planScanArgv('nuclei', ['stub.test'], { severity: ['high', 'critical'], rateLimit: 10 }, resolve)
    expect(plan).toEqual({
      flags: ['-json', '-exclude-tags', 'dos', '-severity', 'high,critical', '-rl', '10'],
      positionalTargets: ['stub.test'],
    })
  })

  it('httpx: json default first; katana minimal; nmap mixed flags then targets', () => {
    expect(planScanArgv('httpx', ['stub.test'], { ports: '80,443', silent: true }, resolve)).toEqual({
      flags: ['-json', '-p', '80,443', '-silent'],
      positionalTargets: ['stub.test'],
    })
    expect(planScanArgv('katana', ['https://stub.test'], {}, resolve)).toEqual({
      flags: [], positionalTargets: ['https://stub.test'],
    })
    expect(planScanArgv('nmap', ['stub.test', '127.0.0.1'], { ports: '1-1000', scripts: 'http-title', noPing: true }, resolve))
      .toEqual({ flags: ['-p', '1-1000', '--script', 'http-title', '-Pn'], positionalTargets: ['stub.test', '127.0.0.1'] })
  })

  it('sqlmap always leads with --batch and takes exactly one target via -u', () => {
    expect(planScanArgv('sqlmap', ['http://stub.test/item'], { level: 3, technique: 'BEU' }, resolve)).toEqual({
      flags: ['--batch', '--level', '3', '--technique', 'BEU', '-u', 'http://stub.test/item'],
      positionalTargets: [],
    })
    expect(() => planScanArgv('sqlmap', ['a.stub.test', 'b.stub.test'], {}, resolve))
      .toThrow(/exactly one target/)
  })

  it('ffuf requires FUZZ url + resolvable wordlist', () => {
    expect(planScanArgv('ffuf', ['stub.test'], { url: 'http://stub.test/FUZZ', wordlist: 'words.txt' }, resolve)).toEqual({
      flags: ['-u', 'http://stub.test/FUZZ', '-w', '/wl/words.txt'],
      positionalTargets: [],
    })
    expect(() => planScanArgv('ffuf', ['stub.test'], { url: 'http://stub.test/no-marker', wordlist: 'w.txt' }, resolve))
      .toThrow(/FUZZ/)
    expect(() => planScanArgv('ffuf', ['stub.test'], {}, resolve)).toThrow(/"url"/)
    expect(() => planScanArgv('ffuf', ['stub.test'], { url: 'http://x/FUZZ' }, resolve)).toThrow(/"wordlist"/)
  })

  it('rejects unknown options naming the allowed set, and unsafe values', () => {
    try {
      planScanArgv('nuclei', ['stub.test'], { rawArgs: '-evil' }, resolve)
      expect.unreachable()
    } catch (error) {
      expect(error).toMatchObject({ code: 'SECURITY_OPTION_UNKNOWN' })
      expect((error as Error).message).toContain('severity')
    }
    expect(() => planScanArgv('nuclei', ['stub.test'], { tags: ['-evil'] }, resolve))
      .toThrow(/must not start with "-"/)
    expect(() => planScanArgv('nmap', ['stub.test'], { timing: 9 }, resolve)).toThrow(/≤ 5/)
    expect(() => planScanArgv('sqlmap', ['http://stub.test'], { risk: true }, resolve))
      .toThrow(/requires an integer/)
    expect(() => planScanArgv('nuclei', ['stub.test'], { severity: ['apocalypse'] }, resolve))
      .toThrow(/accepts only/)
  })

  it('timing accepts the full documented range including zero', () => {
    expect(planScanArgv('nmap', ['stub.test'], { timing: 0 }, resolve).flags).toEqual(['-T', '0'])
    expect(planScanArgv('nmap', ['stub.test'], { timing: 5 }, resolve).flags).toEqual(['-T', '5'])
  })

  it('wordlist starting with a dash is rejected before resolution', () => {
    expect(() => planScanArgv('ffuf', ['stub.test'], { url: 'http://x/FUZZ', wordlist: '-evil' }, raw => raw))
      .toThrow(/must not start with "-"/)
  })
})

describe('LocalSecurityScanProvider execution', () => {
  it('available() reflects pinned binPaths health', async () => {
    const healthy = await mountLocal()
    for (const id of ['nuclei', 'httpx', 'katana', 'ffuf', 'nmap', 'sqlmap'] as const) {
      expect(healthy.available(id), id).toBe(true)
    }
    const broken = new LocalSecurityScanProvider(new Context(), baseConfig({ binPaths: { nuclei: '/absent/nuclei' } }))
    expect(broken.available('nuclei')).toBe(false)
  })

  it('runs each scanner end-to-end with the exact argv and captures output', async () => {
    const provider = await mountLocal({ configEcho: undefined })
    type CaseOptions = Record<string, string | number | boolean | string[]>
    const cases: Array<{ scanner: SecurityScannerId; targets: string[]; options?: CaseOptions; tail: string[] }> = [
      { scanner: 'nuclei', targets: ['stub.test'], options: { severity: 'low', silent: true }, tail: ['-json', '-exclude-tags', 'dos', '-severity', 'low', '-silent', 'stub.test'] },
      { scanner: 'httpx', targets: ['stub.test'], options: { statusCode: '200' }, tail: ['-json', '-sc', '200', 'stub.test'] },
      { scanner: 'katana', targets: ['https://stub.test'], options: { jsFetch: true }, tail: ['-jf', 'https://stub.test'] },
      { scanner: 'ffuf', targets: ['stub.test'], options: { url: 'http://stub.test/FUZZ', wordlist: join(scratch, 'wl.txt') }, tail: ['-u', 'http://stub.test/FUZZ', '-w', join(scratch, 'wl.txt')] },
      { scanner: 'nmap', targets: ['stub.test'], options: { topPorts: 100 }, tail: ['--top-ports', '100', 'stub.test'] },
      { scanner: 'sqlmap', targets: ['http://stub.test/a'], options: { forms: true }, tail: ['--batch', '--forms', '-u', 'http://stub.test/a'] },
    ]
    writeFileSync(join(scratch, 'wl.txt'), 'a\nb\n')
    for (const item of cases) {
      const request: SecurityScanRequest = item.options === undefined
        ? { scanner: item.scanner, targets: item.targets }
        : { scanner: item.scanner, targets: item.targets, options: item.options }
      const result = await provider.scan(request)
      // nuclei is pointed at the deployment's own state directory, so it
      // cannot write its config into whatever directory it ran in.
      const stateFlags = item.scanner === 'nuclei'
        ? ['-config-directory', join(resolveDshHome(), 'tools', 'nuclei')]
        : []
      expect(result.argv, item.scanner).toEqual([BIN, ...stateFlags, ...item.tail])
      expect(result.exitCode, item.scanner).toBe(0)
      expect(result.timedOut, item.scanner).toBe(false)
      expect(result.aborted, item.scanner).toBe(false)
    }
    void ENV_STUB
  })

  it('propagates exit code and stderr text', async () => {
    process.env.STUB_EXIT = '3'
    process.env.STUB_STDERR = 'boom'
    const provider = await mountLocal()
    try {
      const result = await provider.scan({ scanner: 'nuclei', targets: ['stub.test'] })
      expect(result.exitCode).toBe(3)
      expect(result.stderr.text).toBe('boom')
    } finally {
      delete process.env.STUB_EXIT
      delete process.env.STUB_STDERR
    }
  })

  it('deadline produces timedOut=true without abort flag', async () => {
    process.env.STUB_SLEEP_SECONDS = '5'
    const provider = await mountLocal({ timeoutMs: 300 })
    try {
      const startedAt = Date.now()
      const result = await provider.scan({ scanner: 'nuclei', targets: ['stub.test'] })
      expect(result.timedOut).toBe(true)
      expect(result.aborted).toBe(false)
      expect(Date.now() - startedAt).toBeLessThan(2500)
    } finally {
      delete process.env.STUB_SLEEP_SECONDS
    }
  })

  it('outer cancellation classifies as aborted, not timedOut', async () => {
    process.env.STUB_SLEEP_SECONDS = '5'
    const controller = new AbortController()
    setTimeout(() => {
      controller.abort()
    }, 150)
    const provider = await mountLocal()
    try {
      const result = await provider.scan({ scanner: 'nuclei', targets: ['stub.test'] }, controller.signal)
      expect(result.aborted).toBe(true)
      expect(result.timedOut).toBe(false)
    } finally {
      delete process.env.STUB_SLEEP_SECONDS
    }
  })

  it('caps in-memory output, spills the full stream, flags truncation', async () => {
    process.env.STUB_STDOUT = `x${'-'.repeat(500)}`
    const provider = await mountLocal({ maxOutputBytes: 32 })
    try {
      const result = await provider.scan({ scanner: 'nuclei', targets: ['stub.test'] })
      expect(result.stdout.truncated).toBe(true)
      expect(typeof result.stdout.spillPath).toBe('string')
      expect(result.stdout.text.length).toBeLessThanOrEqual(64)
    } finally {
      delete process.env.STUB_STDOUT
    }
  })

  it('a pinned shebang-less binary keeps the precise spawn-level EXEC_FAILED', async () => {
    const broken = new LocalSecurityScanProvider(new Context(), baseConfig({ binPaths: { katana: NO_SHEBANG } }))
    await expect(broken.scan({ scanner: 'katana', targets: ['stub.test'] }))
      .rejects.toMatchObject({ code: 'SECURITY_EXEC_FAILED' })
  })

  it('unresolvable binary fails structurally with PROVIDER_UNAVAILABLE', async () => {
    const absent = new LocalSecurityScanProvider(new Context(), baseConfig({ binPaths: { ffuf: '/absent/ffuf' } }))
    await expect(absent.scan({ scanner: 'ffuf', targets: ['stub.test'] }))
      .rejects.toMatchObject({ code: 'SECURITY_PROVIDER_UNAVAILABLE' })
  })

  it('missing ffuf wordlist is an option error', async () => {
    const provider = await mountLocal()
    await expect(provider.scan({
      scanner: 'ffuf',
      targets: ['stub.test'],
      options: { url: 'http://stub.test/FUZZ', wordlist: 'absent-list.txt' },
    })).rejects.toMatchObject({ code: 'SECURITY_OPTION_INVALID' })
  })
})

describe('binary resolution helpers', () => {
  it('finds executables on a supplied PATH vector only', () => {
    const dir = mkdtempSync(join(tmpdir(), 'path-shim-'))
    try {
      const shim = join(dir, 'shimmed-scanner')
      writeFileSync(shim, '#!/usr/bin/env sh\nexit 0\n')
      chmodSync(shim, 0o755)
      expect(findOnPath('shimmed-scanner', [dir])).toBe(shim)
      expect(findOnPath('definitely-not-here', [dir])).toBeUndefined()
      expect(findOnPath('shimmed-scanner', [])).toBeUndefined()
      mkdirSync(join(dir, 'nested'), { recursive: true })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('assertServiceableConfig rejects non-positive budgets and grace above the timer ceiling', () => {
    const tight = (): void => {
      assertServiceableConfig(baseConfig({ timeoutMs: 0 }))
    }
    expect(tight).toThrow(/timeoutMs/)
    const hugeGrace = (): void => {
      assertServiceableConfig(baseConfig({ graceMs: 2 ** 31 }))
    }
    expect(hugeGrace).toThrow(/MAX_TIMER_DELAY_MS|no greater/)
    const inverted = (): void => {
      assertServiceableConfig(baseConfig({ maxTimeoutMs: 500, timeoutMs: 1000 }))
    }
    expect(inverted).toThrow(/maxTimeoutMs/)
  })

  it('PATH resolution serves available() when binPaths omits a scanner', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'path-nuclei-'))
    const previousPath = process.env.PATH ?? ''
    try {
      const shim = join(dir, 'nuclei')
      // The provider probes `-version`; a healthy-looking binary answers it.
      writeFileSync(shim, '#!/usr/bin/env sh\nif [ "$1" = "-version" ]; then printf \'nuclei version 9.9.9\\n\'; fi\nexit 0\n')
      chmodSync(shim, 0o755)
      process.env.PATH = `${dir}:${previousPath}`
      const ctx = new Context()
      await ctx.plugin(LocalSubprocessRuntime)
      // Omit the pinned path entirely so resolution falls back to $PATH.
      const { binPaths: _omitted, ...withoutPin } = baseConfig()
      void _omitted
      const provider = new LocalSecurityScanProvider(ctx, withoutPin)
      expect(provider.available('nuclei')).toBe(true)
      const result = await provider.scan({ scanner: 'nuclei', targets: ['stub.test'] })
      expect(result.argv[0]).toBe(shim)
    } finally {
      process.env.PATH = previousPath
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('an impostor earlier in PATH is skipped in favor of a valid binary later', async () => {
    const impostorDir = mkdtempSync(join(tmpdir(), 'path-impostor-'))
    const realDir = mkdtempSync(join(tmpdir(), 'path-real-'))
    const previousPath = process.env.PATH ?? ''
    try {
      // Python-httpx-like CLI: same name, wrong option grammar, exits 0 with a usage screen.
      const impostor = join(impostorDir, 'httpx')
      writeFileSync(impostor, '#!/usr/bin/env sh\nprintf \'Usage: httpx [OPTIONS] URL\\n\' >&2\nexit 0\n')
      chmodSync(impostor, 0o755)
      // Valid projectdiscovery-style binary later on PATH.
      const real = join(realDir, 'httpx')
      writeFileSync(real, '#!/usr/bin/env sh\nif [ "$1" = "-version" ]; then printf \'httpx version 1.3.3\\n\'; fi\nif [ "${STUB_ARGV:-0}" = "1" ]; then shift; for arg in "$@"; do printf \'%s\\n\' "$arg"; done; fi\nexit 0\n')
      chmodSync(real, 0o755)
      process.env.PATH = `${impostorDir}:${realDir}:${previousPath}`

      const ctx = new Context()
      await ctx.plugin(LocalSubprocessRuntime)
      const { binPaths: _omitted, ...withoutPin } = baseConfig()
      void _omitted
      const provider = new LocalSecurityScanProvider(ctx, withoutPin)

      const result = await provider.scan({ scanner: 'httpx', targets: ['127.0.0.1'] })
      expect(result.argv[0]).toBe(real)
      expect(result.exitCode).toBe(0)
    } finally {
      process.env.PATH = previousPath
      rmSync(impostorDir, { recursive: true, force: true })
      rmSync(realDir, { recursive: true, force: true })
    }
  })
})

describe('config guard', () => {
  it('accepts the canonical defaults', () => {
    const defaults = (): void => {
      assertServiceableConfig(baseConfig())
    }
    expect(defaults).not.toThrow()
    expect(SecurityScanError).toBeDefined()
  })
})

describe('planner edge coverage', () => {
  const resolve = (raw: string): string => `/wl/${raw}`

  it('csv rules require strings and a non-empty set', () => {
    expect(() => planScanArgv('nuclei', ['stub.test'], { severity: [1] }, resolve)).toThrow(/string or array/)
    expect(() => planScanArgv('nuclei', ['stub.test'], { severity: [] }, resolve)).toThrow(/string or array/)
  })

  it('int rules reject fractional values', () => {
    expect(() => planScanArgv('nuclei', ['stub.test'], { rateLimit: 1.5 }, resolve)).toThrow(/requires an integer/)
  })

  it('string rules reject numbers', () => {
    expect(() => planScanArgv('httpx', ['stub.test'], { ports: 80 }, resolve)).toThrow(/requires a string/)
  })

  it('sqlmap dual targets rejected at plan level', () => {
    expect(() => planScanArgv('sqlmap', ['a.stub.test', 'b.stub.test'], {}, resolve)).toThrow(/exactly one target/)
  })

  it('omitted options object falls back to scanner defaults alone', () => {
    expect(planScanArgv('katana', ['https://stub.test'], undefined, resolve)).toEqual({
      flags: [],
      positionalTargets: ['https://stub.test'],
    })
  })
})

describe('plugin apply and failure mapper', () => {
  it('apply() registers the local provider into the mounted runtime', async () => {
    const ctx = new Context()
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(SecurityScanRuntime, { allowlist: ['stub.test'] })
    const Local = await import('../src/index.ts')
    await ctx.plugin(Local, baseConfig())
    const result = await ctx.securityScan.scan({ scanner: 'nuclei', targets: ['stub.test'] })
    expect(result.argv[0]).toBe(BIN)
  })

  it('maps child exec failures through the done-rejection mapper', async () => {
    const badInterp = join(scratch, 'bad-interp')
    writeFileSync(badInterp, '#!/usr/bin/no-such-shell\nexit 0\n')
    chmodSync(badInterp, 0o755)
    const ctx = new Context()
    await ctx.plugin(LocalSubprocessRuntime)
    const bound = new LocalSecurityScanProvider(ctx, baseConfig({ binPaths: { nuclei: badInterp } }))
    await expect(bound.scan({ scanner: 'nuclei', targets: ['stub.test'] }))
      .rejects.toMatchObject({ code: 'SECURITY_EXEC_FAILED' })
  })
})

describe('whitelist value-rule edges', () => {
  const resolve = (raw: string): string => `/wl/${raw}`

  it('boolean rules require booleans and omit false flags', () => {
    expect(() => planScanArgv('katana', ['https://stub.test'], { jsFetch: 'yes' }, resolve))
      .toThrow(/requires a boolean/)
    const plan = planScanArgv('nuclei', ['stub.test'], { silent: false }, resolve)
    expect(plan.flags).not.toContain('-silent')
  })

  it('int minimum bound rejects zero where the flag forbids it', () => {
    expect(() => planScanArgv('nuclei', ['stub.test'], { rateLimit: 0 }, resolve)).toThrow(/≥ 1/)
  })

  it('string rules reject numeric values', () => {
    expect(() => planScanArgv('httpx', ['stub.test'], { ports: 80 }, resolve)).toThrow(/requires a string/)
  })

  it('csv rules reject non-string members', () => {
    expect(() => planScanArgv('nuclei', ['stub.test'], { severity: [7] }, resolve)).toThrow(/string or array/)
  })
})

describe('binary resolution helpers', () => {
  it('findOnPath ignores existing but non-executable files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'quiet-bin-'))
    try {
      writeFileSync(join(dir, 'quiet.bin'), 'data')
      expect(findOnPath('quiet.bin', [dir])).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('wordlistDirs hit resolves relative names to absolute paths', async () => {
    writeFileSync(join(scratch, 'dir-list.txt'), 'a\n')
    const provider = await mountLocal()
    const result = await provider.scan({
      scanner: 'ffuf',
      targets: ['stub.test'],
      options: { url: 'http://stub.test/FUZZ', wordlist: 'dir-list.txt' },
    })
    expect(result.argv).toContain(join(scratch, 'dir-list.txt'))
  })
})

describe('PATH-less environments', () => {
  it('availability falls back to false when PATH is absent', async () => {
    const ctx = new Context()
    await ctx.plugin(LocalSubprocessRuntime)
    const { binPaths: _omitted, ...withoutPathSource } = baseConfig()
    void _omitted
    const previousPath = process.env.PATH
    delete process.env.PATH
    try {
      const provider = new LocalSecurityScanProvider(ctx, withoutPathSource)
      expect(provider.available('nuclei')).toBe(false)
    } finally {
      process.env.PATH = previousPath
    }
  })
})

describe('binary identity probe', () => {
  it('looksLikeScannerBinary accepts version output, rejects usage screens and non-zero exits', async () => {
    const { looksLikeScannerBinary } = await import('../src/index.ts')
    expect(looksLikeScannerBinary('Nuclei Engine Version: v3.0.0', 0)).toBe(true)
    expect(looksLikeScannerBinary('', 0)).toBe(false)
    expect(looksLikeScannerBinary('Usage: httpx [OPTIONS] URL\nError: bad flag', 2)).toBe(false)
    expect(looksLikeScannerBinary('Some output', 1)).toBe(false)
  })

  it('scan rejects a same-named impostor binary with SECURITY_BINARY_MISMATCH', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'impostor-pin-'))
    try {
      // A pinned binary that answers -version with a usage screen and exit 2:
      // the Python `httpx`-style same-named CLI.
      const impostor = join(dir, 'nuclei')
      writeFileSync(impostor, '#!/usr/bin/env sh\nprintf \'Usage: nuclei [OPTIONS] URL\\nError: Invalid value\\n\' >&2\nexit 2\n')
      chmodSync(impostor, 0o755)
      const provider = new LocalSecurityScanProvider(new Context(), baseConfig({ binPaths: { nuclei: impostor } }))
      await expect(provider.scan({ scanner: 'nuclei', targets: ['stub.test'] }))
        .rejects.toMatchObject({ code: 'SECURITY_BINARY_MISMATCH' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
