/**
 * Local Service Provider for the security-scanning seam: resolves installed
 * scanner binaries, plans argv through the per-scanner whitelists, and runs
 * the process via `ctx.subprocess` — never a shell. Deadlines, cause
 * classification, bounded output, and spill follow the bash-local executor
 * semantics.
 *
 * @module @deepseek-ai/dsh-security-scan-local-moses
 */

import { accessSync, constants, existsSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-security-scan-moses'
import { SecurityScanError } from '@deepseek-ai/dsh-security-scan-moses'
import type {
  ScanOutput,
  SecurityScanProvider,
  SecurityScanRequest,
  SecurityScanResult,
  SecurityScannerId,
} from '@deepseek-ai/dsh-security-scan-moses'
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

/**
 * Where a scanner keeps what it remembers between runs.
 *
 * Scanners write configuration and template caches next to wherever they were
 * started. That state belongs to NEITHER side of a scan: not to the project —
 * an agent works in someone's repository, and tool droppings there show up in
 * their `git status` and their commits — and not to the harness checkout,
 * which is code. It belongs with the deployment's own state, one directory per
 * scanner so two of them cannot fight over a file name.
 *
 * `HOME` and `XDG_CONFIG_HOME` cover any scanner that follows the usual
 * conventions; a tool with its own flag gets it in {@link planScanArgv}.
 * @param scanner - which scanner is about to run.
 * @returns environment entries pointing its state at the deployment's store.
 */
function stateEnvironment(scanner: SecurityScannerId): Record<string, string> {
  const home = join(resolveDshHome(), 'tools', scanner)
  // Created up front: a scanner that cannot write its config falls back to the
  // working directory, which is the behavior this exists to prevent.
  mkdirSync(home, { recursive: true })
  return { HOME: home, XDG_CONFIG_HOME: join(home, 'config'), XDG_DATA_HOME: join(home, 'data') }
}

/**
 * Identity-probe argv per scanner. Every projectdiscovery tool answers
 * `-version` with a version line; nmap spells it `--version`; sqlmap also
 * speaks `--version`. A binary that exits non-zero or dumps a usage screen on
 * this probe is a same-named CLI from some other package, not our scanner.
 */
const IDENTITY_PROBE_FLAGS: Record<SecurityScannerId, readonly string[]> = {
  nuclei: ['-version'],
  httpx: ['-version'],
  katana: ['-version'],
  ffuf: ['-version'],
  nmap: ['--version'],
  sqlmap: ['--version'],
}

/**
 * Binary paths that already passed the identity probe live on the provider
 * INSTANCE: a second provider may point the same scanner name at a different
 * binary, and its verdict must be computed fresh.
 */

/**
 * Whether one probe response looks like the expected scanner: clean exit,
 * non-empty output (every supported tool prints a version line), and no
 * usage/error screen — the telltale signature of a same-named CLI from
 * another package answering its own option grammar instead.
 * @param output - complete probe stdout; identity evidence lives here.
 * @param exitCode - probe exit status; nonzero rejects before content checks.
 * @returns true when the binary may be treated as the expected scanner.
 */
export function looksLikeScannerBinary(output: string, exitCode: number): boolean {
  if (exitCode !== 0) return false
  const text = output.trim()
  return text.length > 0 && !/^Usage:/m.test(text) && !/^Error:/m.test(text)
}

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

/** Validate schema-defaulted config loudly at load time.
 * @param config - the resolved provider configuration to check.
 * @throws Error naming the first field that cannot be used.
 */
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

/** Resolve a scanner binary name on a supplied PATH vector.
 * @param name - the scanner binary filename to look for.
 * @param pathEnv - pre-split PATH directories, in order.
 * @returns the first executable match, or undefined when absent anywhere.
 */
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

  /** Per-instance cache of binary paths that passed the identity probe. */
  private readonly identityVerified = new Set<string>()

  constructor(
    private readonly ctx: Context,
    private readonly config: ResolvedConfig,
  ) {}

  available(scanner: SecurityScannerId): boolean {
    return this.binaryPath(scanner) !== undefined
  }

  async scan(request: SecurityScanRequest, signal?: AbortSignal): Promise<SecurityScanResult> {
    const startedAt = Date.now()
    const binaryPath = this.resolveVerifiedBinary(request.scanner)
    const argvTail = planScanArgv(request.scanner, request.targets, request.options ?? {}, raw => this.resolveWordlist(raw))
    const state = stateEnvironment(request.scanner)
    // nuclei reads its own flag before the environment, so the flag has to say
    // the same thing — otherwise it writes `.nuclei-config` into the working
    // directory, which is the caller's project.
    const stateFlags = request.scanner === 'nuclei' && state.HOME !== undefined
      ? ['-config-directory', state.HOME]
      : []
    const argv = [binaryPath, ...stateFlags, ...argvTail.flags, ...argvTail.positionalTargets]

    // One deadline combines the provider budget with upstream cancellation;
    // only THIS deadline counts as timedOut, outer aborts count as aborted.
    using guard = deadline(signal, this.effectiveTimeoutMs(), 'SECURITY_SCAN_TIMEOUT')
    let handle: SubprocessHandle
    try {
      handle = this.ctx.subprocess.spawn({
        argv,
        // The caller's workspace when it named one; the configured directory
        // is the fallback for a direct service call with no agent behind it.
        cwd: request.cwd ?? this.config.cwd,
        stdio: {
          stdin: 'ignore',
          stdout: this.collect(),
          stderr: this.collect(),
        },
        graceMs: this.config.graceMs,
        signal: guard.signal,
        env: { ...ENV_OVERRIDES, ...state },
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

  /**
   * One blocking `-version`/`--version` probe (≤5 s) of the resolved binary,
   * cached per path. Throw when the binary does not behave like the expected
   * scanner — PATH frequently carries same-named CLIs (e.g. the Python
   * `httpx` library ships a `httpx` command whose `-j` means "JSON body"),
   * and a wrong binary otherwise fails deep inside flag parsing with an
   * error far from the root cause.
   */
  private assertBinaryIdentity(scanner: SecurityScannerId, binaryPath: string): void {
    if (this.identityVerified.has(binaryPath)) return
    // spawnSync (not execFileSync): exits non-zero must NOT throw — the stderr
    // content IS the evidence, and projectdiscovery banners land on stderr.
    const probe = spawnSync(binaryPath, IDENTITY_PROBE_FLAGS[scanner], {
      timeout: 5_000,
      encoding: 'utf8',
      env: { ...ENV_OVERRIDES },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const exitCode = probe.status ?? -1
    // Spawn-level failures (broken interpreter, vanished binary — probe.error
    // set with a filesystem errno) are NOT identity verdicts: defer them so
    // the execution path reports its precise SECURITY_EXEC_FAILED.
    const spawnBroken = probe.error !== undefined
      && ['ENOEXEC', 'EACCES', 'ENOENT', 'ELOOP', 'ETXTBSY'].includes((probe.error as NodeJS.ErrnoException).code ?? '')
    if (spawnBroken) return
    const output = `${probe.stdout}\n${probe.stderr}`
    if (!looksLikeScannerBinary(output, exitCode)) {
      const detail = output.trim().split('\n').slice(0, 2).join(' ⏎ ')
      throw new SecurityScanError(
        `resolved ${binaryPath} for scanner "${scanner}" failed the identity probe `
          + `(${IDENTITY_PROBE_FLAGS[scanner].join(' ')} exited ${exitCode}${detail === '' ? '' : `: ${detail}`}) — `
          + 'this host has a same-named CLI from another package. Install the projectdiscovery/nmap/sqlmap '
          + `binary or pin binPaths["${scanner}"] to its explicit path.`,
        'SECURITY_BINARY_MISMATCH',
      )
    }
    this.identityVerified.add(binaryPath)
  }

  /**
   * First binary for `scanner` that EXISTS on PATH and passes the identity
   * probe. A wrong same-named CLI earlier in PATH is skipped in favor of a
   * valid match later; only an exhausted search fails, naming every tried
   * path so the fix is obvious.
   */
  private resolveVerifiedBinary(scanner: SecurityScannerId): string {
    const pinned = this.config.binPaths?.[scanner]
    if (pinned !== undefined) {
      if (!isExecutable(pinned)) {
        throw new SecurityScanError(
          `scanner "${scanner}" pinned binPaths entry is missing or not executable: ${pinned}`,
          'SECURITY_PROVIDER_UNAVAILABLE',
        )
      }
      this.assertBinaryIdentity(scanner, pinned)
      return pinned
    }
    const segments = (process.env.PATH ?? '').split(':').filter(entry => entry.length > 0)
    const tried: string[] = []
    let unavailable: SecurityScanError | undefined
    for (const dir of segments) {
      const candidate = join(dir, scanner)
      if (!isExecutable(candidate)) continue
      tried.push(candidate)
      try {
        this.assertBinaryIdentity(scanner, candidate)
        return candidate
      } catch (error) {
        if (error instanceof SecurityScanError && error.code !== 'SECURITY_BINARY_MISMATCH') throw error
        unavailable = error instanceof SecurityScanError ? error : unavailable
      }
    }
    if (unavailable !== undefined) throw unavailable
    throw new SecurityScanError(
      `scanner "${scanner}" binary is not installed or not executable on this host`,
      'SECURITY_PROVIDER_UNAVAILABLE',
    )
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
