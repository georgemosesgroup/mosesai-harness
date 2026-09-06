/**
 * Read-only git execution over one workspace root. The command allowlist is
 * fixed in code: nothing here can stage, commit, push, or otherwise mutate a
 * repository. Arguments travel as an execFile argv array (no shell), and user
 * paths always pass behind `--` so revision-shaped input cannot be mistaken
 * for options.
 * @module @deepseek-ai/dsh-dif-explorer/gitrun
 */

import { execFile } from 'node:child_process'

/** Raised when git is missing, exits nonzero, or refuses to finish in time. */
export class GitRunnerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GitRunnerError'
  }
}

/** Longest stdout/stderr text accepted from one git invocation. */
const MAX_GIT_OUTPUT_BYTES = 32 * 1024 * 1024

/** Per-invocation wall-clock budget before the child is killed. */
const GIT_TIMEOUT_MS = 15_000

/** The complete set of invocations this module may ever spawn. */
const ALLOWED_SUBCOMMANDS = new Set([
  'status',
  'diff',
  'log',
  'show',
  'ls-files',
  'rev-parse',
  'cat-file',
  'name-rev',
])

/**
 * Extra arguments and output selection for one allowlisted git invocation.
 */
export interface GitRunOptions {
  /** Additional argv after the subcommand (git's own args, ordered). */
  readonly args?: readonly string[]
  /** Cancelled work kills the child. */
  readonly signal?: AbortSignal | undefined
  /** Return raw stdout bytes instead of UTF-8 text (binary-safe reads). */
  readonly raw?: boolean
}

/**
 * Spawn one allowlisted read-only git command inside `root`.
 * @param root - canonical workspace root used as the child's cwd.
 * @param subcommand - the git subcommand; must appear on the fixed allowlist.
 * @param options - extra argv, cancellation, and raw-byte output selection.
 * @returns the full stdout of the invocation (string, or Buffer when `raw`).
 * @throws {GitRunnerError} when the subcommand is not allowlisted or git fails.
 */
/**
 * Spawn one allowlisted read-only git command inside `root`.
 * @param root - canonical workspace root used as the child's cwd.
 * @param subcommand - the git subcommand; must appear on the fixed allowlist.
 * @param options - extra argv, cancellation, and output selection.
 * @returns the full stdout of the invocation.
 */
export function runGit(
  root: string,
  subcommand: string,
  options: GitRunOptions & { raw?: false },
): Promise<string>
/**
 * Raw-byte overload: identical semantics with a Buffer result.
 * @param root - canonical workspace root used as the child's cwd.
 * @param subcommand - the git subcommand; must appear on the fixed allowlist.
 * @param options - extra argv, cancellation, and raw-byte output selection.
 * @returns the full stdout as a Buffer.
 */
export function runGit(
  root: string,
  subcommand: string,
  options: GitRunOptions & { raw: true },
): Promise<Buffer>
export function runGit(
  root: string,
  subcommand: string,
  options: GitRunOptions,
): Promise<string | Buffer> {
  if (!ALLOWED_SUBCOMMANDS.has(subcommand)) {
    return Promise.reject(new GitRunnerError(`git ${subcommand} is not on the dif-explorer read-only allowlist`))
  }
  const argv = ['--no-optional-locks', '--no-pager', subcommand, ...options.args ?? []]
  return new Promise((resolveRun, rejectRun) => {
    const child = execFile(
      'git',
      argv,
      {
        cwd: root,
        maxBuffer: MAX_GIT_OUTPUT_BYTES,
        timeout: GIT_TIMEOUT_MS,
        killSignal: 'SIGKILL',
        encoding: options.raw === true ? 'buffer' : 'utf8',
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' },
      } as const,
      (error: Error | null, stdout: string | Buffer) => {
        if (error !== null) {
          rejectRun(new GitRunnerError(`git ${subcommand} failed: ${summarize(error)}`))
        } else {
          resolveRun(stdout)
        }
      },
    )
    options.signal?.addEventListener('abort', () => { child.kill('SIGKILL') }, { once: true })
  })
}

function summarize(error: Error): string {
  const message = error.message.split('\n')[0] ?? ''
  return message.length > 300 ? `${message.slice(0, 300)}…` : message
}

/** One parsed `-z` record pair of `git status --porcelain=v1 -z`. */
export interface PorcelainRecord {
  readonly xy: string
  readonly path: string
  /** Present for renames/copies (`XY to-path \0 orig-path`). */
  readonly origPath?: string
}

/**
 * Parse `git status --porcelain=v1 -z` output into records.
 * @param output - raw NUL-separated porcelain output.
 * @returns records in output order.
 */
export function parsePorcelainZ(output: string): readonly PorcelainRecord[] {
  const parts = output.split('\0')
  const records: PorcelainRecord[] = []
  for (let i = 0; i < parts.length - 1;) {
    const entry = parts[i]
    if (entry === undefined || entry.length < 4) {
      i++
      continue
    }
    const xy = entry.slice(0, 2)
    const first = entry.slice(3)
    // Rename records are followed by their origin path as the next NUL field.
    if (xy.includes('R') || xy.includes('C')) {
      const orig = parts[i + 1]
      i += 2
      records.push(orig === undefined || orig.length === 0
        ? { xy, path: first }
        : { xy, path: first, origPath: orig })
    } else {
      i += 1
      records.push({ xy, path: first })
    }
  }
  return records
}

/**
 * Map porcelain XY pairs onto the four-wire status letters (index side wins).
 * @param xy - the two-letter porcelain status field.
 * @returns the wire status letter for the change.
 */
export function statusFromPorcelain(xy: string): 'A' | 'M' | 'D' | 'R' {
  if (xy.includes('?')) return 'A'
  const code = xy.charAt(0)
  if (code === 'R' || code === 'C') return 'R'
  if (code === 'A') return 'A'
  if (code === 'D') return 'D'
  return 'M'
}

/** One parsed `git log --name-status` file change. */
export interface NameStatusChange {
  readonly status: 'A' | 'M' | 'D' | 'R'
  readonly path: string
  readonly oldPath?: string
}

/**
 * Parse one `git log --name-status -z --format=%x1e%H%x1f%cI` commit block.
 * A leading record separator left by naive splitting is tolerated.
 * @param blockRaw - a single `\u001e`-separated chunk (header line then NUL-separated changes).
 * @returns the commit oid with its file changes.
 */
export function parseLogBlock(blockRaw: string): {
  readonly oid: string
  readonly at: string
  readonly changes: readonly NameStatusChange[]
} | undefined {
  const block = blockRaw.replace(/^\u001e/, '')
  const lines = block.split('\n')
  const header = lines[0]
  if (header === undefined || header.trim().length === 0) return undefined
  const [oidRaw = '', atRaw = ''] = header.split('\u001f')
  // In `-z` mode git terminates the whole commit record with NUL too, so the
  // last field arrives suffixed with one.
  const oid = oidRaw.replaceAll('\0', '').trim()
  const at = atRaw.replaceAll('\0', '').trim()
  const changes: NameStatusChange[] = []
  const body = block.slice(header.length + 1)
  const fields = body.split('\0').filter(field => field.trim().length > 0)
  for (let i = 0; i < fields.length;) {
    const op = fields[i]?.trim()
    if (op === undefined || op.length === 0) break
    const letter = op.charAt(0)
    if (!['A', 'M', 'D', 'R', 'C'].includes(letter)) {
      i++
      continue
    }
    const pathField = fields[i + 1] ?? ''
    if (letter === 'R' || letter === 'C') {
      const nextPath = fields[i + 2] ?? ''
      changes.push({ status: 'R', path: nextPath, oldPath: pathField })
      i += 3
    } else {
      changes.push({ status: letter as 'A' | 'M' | 'D', path: pathField })
      i += 2
    }
  }
  return { oid, at, changes }
}

/** Numerical diff summary as `git diff --numstat` reports it per path. */
export interface NumStatRow {
  readonly additions: number
  readonly deletions: number
  readonly path: string
}

/**
 * Parse `--numstat -z` output; binary rows report `-\t-` and yield null counts.
 * @param output - raw numstat output (NUL-separated when requested).
 * @returns one row per changed path.
 */
export function parseNumstatZ(output: string): readonly NumStatRow[] {
  const rows: NumStatRow[] = []
  for (const field of output.split('\0')) {
    const line = field.replace(/^\n/, '')
    if (line.trim().length === 0) continue
    const match = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line)
    if (match === null) continue
    rows.push({
      additions: match[1] === '-' ? 0 : Number(match[1]),
      deletions: match[2] === '-' ? 0 : Number(match[2]),
      path: match[3] ?? '',
    })
  }
  return rows
}
