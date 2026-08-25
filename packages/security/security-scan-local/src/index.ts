/**
 * Local Service Provider for the security-scanning seam: resolves installed
 * scanner binaries, plans argv through the per-scanner whitelists, and runs
 * the process via `ctx.subprocess` — never a shell. Deadlines, cause
 * classification, bounded output, and spill follow the bash-local executor
 * semantics.
 *
 * @module @deepseek-ai/dsh-security-scan-local
 */

import { accessSync, constants, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-security-scan'
import { SecurityScanError } from '@deepseek-ai/dsh-security-scan'
import type {
  ScanOutput,
  SecurityScanProvider,
  SecurityScanRequest,
  SecurityScanResult,
  SecurityScannerId,
} from '@deepseek-ai/dsh-security-scan'
import type { SubprocessCollect, SubprocessHandle, SubprocessOutputReader } from '@deepseek-ai/dsh-subprocess'
import { MAX_TIMER_DELAY_MS, clampTimeout, deadline, timeoutOf } from '@deepseek-ai/dsh-timeout'
import { planScanArgv } from './scanners.ts'

export { planScanArgv, SCANNER_SPECS } from './scanners.ts'
export type { WordlistResolver } from './scanners.ts'

/**
 * Terminal-friendly environment for scanner output (the bash-local set):
 * no colors, no pagers, nothing interactive.
 */
const ENV_OVERRIDES = {
  NO_COLOR: '1',
  TERM: 'dumb',
  PAGER: 'cat',
  GIT_PAGER: 'cat',
} as const

/** Plugin config; every field is defaulted and validated at load. */
export interface Config {
  /** Explicit binary path per scanner; omit to resolve the name on PATH. */
  binPaths?: Record<string, string>
  /** Directories an ffuf `wordlist` option may be relative to. */
  wordlistDirs?: string[]
  /** Working directory for scan processes (default: process.cwd()). */
  cwd?: string
  /** Default scan deadline in milliseconds. */
  timeoutMs?: number
  /** Upper bound applied to {@link Config.timeoutMs}; scans are long, so this defaults high. */
  maxTimeoutMs?: number
  /** Per-stream in-memory output cap; overflow keeps the tail. */
  maxOutputBytes?: number
  /** Per-stream spill cap for the complete stream when truncated. */
  maxSpillBytes?: number
  /** SIGTERM→SIGKILL escalation grace; at most MAX_TIMER_DELAY_MS. */
  graceMs?: number
}

export const Config: z<Config> = z.object({
  binPaths: z.dict(z.string()),
  wordlistDirs: z.array(z.string()).default([]),
  cwd: z.string(),
  timeoutMs: z.number().default(600_000),
  maxTimeoutMs: z.number().default(3_600_000),
  maxOutputBytes: z.number().default(64_000),
  maxSpillBytes: z.number().default(64 * 1024 * 1024),
  graceMs: z.number().default(3_000),
})

/** Complete config after schemastery applies every field default (binPaths stays optional). */
type ResolvedConfig = Required<Omit<Config, 'binPaths'>> & Pick<Config, 'binPaths'>

function assertPositiveFinite(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`security-scan-local: ${name} must be a positive finite number`)
  }
}

/** Validate schema-defaulted config loudly at load time. */
export function assertServiceableConfig(config: ResolvedConfig): void {
  assertPositiveFinite('timeoutMs', config.timeoutMs)
  assertPositiveFinite('maxTimeoutMs', config.maxTimeoutMs)
  assertPositiveFinite('maxOutputBytes', config.maxOutputBytes)
  assertPositiveFinite('maxSpillBytes', config.maxSpillBytes)
  assertPositiveFinite('graceMs', config.graceMs)
  if (config.graceMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`security-scan-local: graceMs must be no greater than ${MAX_TIMER_DELAY_MS}`)
  }
  if (!Number.isInteger(config.maxTimeoutMs) || config.maxTimeoutMs < config.timeoutMs) {
    throw new Error('security-scan-local: maxTimeoutMs must be an integer ≥ timeoutMs')
  }
}

/** Whether one filesystem path exists AND is executable by this user. */
function isExecutable(path: string): boolean {
  if (!existsSync(path)) return false
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** Resolve a scanner binary name on `$PATH`; undefined when absent anywhere. */
export function findOnPath(name: string, pathEnv: readonly string[]): string | undefined {
  for (const dir of pathEnv) {
    const candidate = join(dir, name)
    if (isExecutable(candidate)) return candidate
  }
  return undefined
}

/** Project a settled collect-mode reader into the seam's ScanOutput shape. */
function finalOutput(reader: SubprocessOutputReader): ScanOutput {
  const read = reader.readFrom(0)
  return {
    text: read.text,
    truncated: read.lossy,
    ...read.spillPath !== undefined ? { spillPath: read.spillPath } : {},
  }
}

/**
 * The local provider behind `ctx.securityScan`: one instance serves every
 * scanner through per-scanner binaries and whitelisted flags.
 */
export class LocalSecurityScanProvider implements SecurityScanProvider {
  readonly id = 'local'

  constructor(
    private readonly ctx: Context,
    private readonly config: ResolvedConfig,
  ) {}

  available(scanner: SecurityScannerId): boolean {
    return this.binaryPath(scanner) !== undefined
  }

  async scan(request: SecurityScanRequest, signal?: AbortSignal): Promise<SecurityScanResult> {
    const startedAt = Date.now()
    const binaryPath = this.requireBinary(request.scanner)
    const argvTail = planScanArgv(request.scanner, request.targets, request.options ?? {}, raw => this.resolveWordlist(raw))
    const argv = [binaryPath, ...argvTail.flags, ...argvTail.positionalTargets]

    // One deadline combines the provider budget with upstream cancellation;
    // only THIS deadline counts as timedOut, outer aborts count as aborted.
    using guard = deadline(signal, this.effectiveTimeoutMs(), 'SECURITY_SCAN_TIMEOUT')
    let handle: SubprocessHandle
    try {
      handle = this.ctx.subprocess.spawn({
        argv,
        cwd: this.config.cwd,
        stdio: {
          stdin: 'ignore',
          stdout: this.collect(),
          stderr: this.collect(),
        },
        graceMs: this.config.graceMs,
        signal: guard.signal,
        env: { ...ENV_OVERRIDES },
      })
    } catch (error) {
      throw new SecurityScanError(
        `failed to spawn scanner "${request.scanner}" (${binaryPath}): ${String(error)}`,
        'SECURITY_EXEC_FAILED',
        { cause: error },
      )
    }

    // Spawn-level failures reject the done promise; classify them as exec failures.
    const outcome = await handle.done.catch((error: unknown): never => {
      throw new SecurityScanError(
        `failed to run scanner "${request.scanner}" (${binaryPath}): ${String(error)}`,
        'SECURITY_EXEC_FAILED',
        { cause: error },
      )
    })
    const stdout = finalOutput(requireReader(handle, 'stdout'))
    const stderr = finalOutput(requireReader(handle, 'stderr'))
    const timedOut = timeoutOf(guard.signal, 'SECURITY_SCAN_TIMEOUT') !== undefined
    const aborted = guard.signal.aborted && !timedOut
    return {
      scanner: request.scanner,
      argv,
      exitCode: outcome.exitCode,
      signal: outcome.signal,
      timedOut,
      aborted,
      durationMs: Date.now() - startedAt,
      stdout,
      stderr,
    }
  }

  private effectiveTimeoutMs(): number {
    // clampTimeout(undefined, default, max, label) yields the configured
    // budget capped by the configured maximum — exactly the two fields' roles.
    return clampTimeout(undefined, this.config.timeoutMs, this.config.maxTimeoutMs, 'security-scan-local: timeoutMs')
  }

  private collect(): SubprocessCollect {
    return { maxBytes: this.config.maxOutputBytes, spill: { maxBytes: this.config.maxSpillBytes } }
  }

  /** Binary path or undefined; a pinned path that does not exist does NOT fall back to PATH. */
  private binaryPath(scanner: SecurityScannerId): string | undefined {
    const pinned = this.config.binPaths?.[scanner]
    if (pinned !== undefined) return isExecutable(pinned) ? pinned : undefined
    const segments = (process.env.PATH ?? '').split(':').filter(entry => entry.length > 0)
    return findOnPath(scanner, segments)
  }

  private requireBinary(scanner: SecurityScannerId): string {
    const path = this.binaryPath(scanner)
    if (path === undefined) {
      throw new SecurityScanError(
        `scanner "${scanner}" binary is not installed or not executable on this host`,
        'SECURITY_PROVIDER_UNAVAILABLE',
      )
    }
    return path
  }

  /**
   * Resolve an ffuf `-w` value: absolute paths pass through (existence checked),
   * relative paths resolve against the configured `wordlistDirs` in order.
   */
  private resolveWordlist(rawPath: string): string {
    if (existsSync(rawPath)) return rawPath
    for (const dir of this.config.wordlistDirs) {
      const candidate = join(dir, rawPath)
      if (existsSync(candidate)) return candidate
    }
    throw new SecurityScanError(
      `ffuf wordlist "${rawPath}" not found (absolute, or under wordlistDirs)`,
      'SECURITY_OPTION_INVALID',
    )
  }
}

/** Collect-mode readers are present by construction; defensive narrow keeps types honest. */
function requireReader(handle: SubprocessHandle, stream: 'stdout' | 'stderr'): SubprocessOutputReader {
  const reader = handle.collected[stream]
  /* v8 ignore next -- the dispositions above request both collectors by construction; defensive. */
  if (reader === undefined) {
    throw new SecurityScanError(
      'subprocess implementation dropped a requested collect stream',
      'SECURITY_EXEC_FAILED',
    )
  }
  return reader
}

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'security-scan-local'

/** The seam this provider registers into, plus the executor it spawns through. */
export const inject = ['securityScan', 'subprocess']

/** Register the local provider with `ctx.securityScan`. */
export function apply(ctx: Context, config: Config): void {
  // schemastery (Config) has already filled every defaulted field.
  const resolved = config as ResolvedConfig
  assertServiceableConfig(resolved)
  ctx.securityScan.registerProvider(new LocalSecurityScanProvider(ctx, resolved))
}
