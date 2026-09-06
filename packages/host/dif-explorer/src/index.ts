/**
 * DIF Explorer Host gateway: one read-only Remote namespace (`difExplorer`)
 * over workspace roots, their file trees, the change ledger (sessions,
 * worktree, commits), file content, and before/after diffs. Every method is
 * side-effect free; filesystem access is confined to the canonical workspace
 * root and git runs through the fixed allowlist in `gitrun.ts`.
 * @module @deepseek-ai/dsh-dif-explorer
 */

import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-session-persistence'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { realpathNormalize } from '@deepseek-ai/dsh-workspace'
import type { WorkspaceRegistry } from '@deepseek-ai/dsh-workspace'
import {
  buildHunks,
  capRows,
  looksBinary,
  MAX_DIFF_SIDE_BYTES,
  prepareSides,
  sha256Hex,
} from './difflib.ts'
import {
  GitRunnerError,
  parseLogBlock,
  parseNumstatZ,
  parsePorcelainZ,
  runGit,
  statusFromPorcelain,
} from './gitrun.ts'
import { PathOutsideWorkspaceError, resolveInsideRoot } from './paths.ts'
import {
  decodeMutatingCalls,
  extractFragment,
  foldSessionChanges,
  type FoldableEvent,
} from './sessionfold.ts'
import { maskFileContent } from './secrets.ts'
import type {
  ChangeEntryView,
  ChangesRequest,
  DiffRequest,
  DiffResponse,
  FileContentRequest,
  FileContentView,
  TreeRequest,
  TreeResponse,
  WorkspaceRootView,
} from './types.ts'

/** Commit ledger depth cap; deeper history stays reachable through later pagination. */
const COMMIT_LEDGER_LIMIT = 300

/** File reads past this cap return head-only text with `truncated: true`. */
const MAX_FILE_READ_BYTES = 512 * 1024

/** UTF-8 text of bytes. */
function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes)
}

/** NUL-separated nonempty fields of one `-z` git output. */
function splitNul(output: string): string[] {
  return output.split('\0').filter(part => part.length > 0)
}

/** Directory-aware path ordering that reads like a file manager's. */
function comparePathSegments(left: string, right: string): number {
  return left.split('/').join('\0').localeCompare(right.split('/').join('\0'))
}

/** A session log event narrowed to what the fold reads. */
function asFoldable(event: SessionEvent): FoldableEvent {
  return {
    type: event.type,
    seq: typeof event.seq === 'number' ? event.seq : undefined,
    ...(typeof event.time === 'number' ? { time: event.time } : {}),
    data: event.data,
  }
}

/** Require one wire field a caller omitted (misuse fails loud). */
function requireDefined<T>(value: T | undefined, field: string): T {
  if (value === undefined) throw new Error(`request lacks "${field}"`)
  return value
}

/**
 * The gateway Cordis plugin. Registered as the `difExplorer` service; methods
 * marked {@link Remote} reach the browser through the generated client contract.
 */
export class DifExplorerGateway extends TypertRemoteService {
  static inject = ['workspaceRegistry', 'sessionPersistence']

  private readonly registry: WorkspaceRegistry
  private readonly persistence: SessionPersistence

  constructor(ctx: Context) {
    super(ctx, 'difExplorer')
    this.registry = ctx.get('workspaceRegistry') as WorkspaceRegistry
    this.persistence = ctx.get('sessionPersistence') as SessionPersistence
  }

  /**
   * List every registered workspace root.
   * @returns roots in registry order.
   */
  @Remote('listRoots')
  listRoots(): { readonly roots: readonly WorkspaceRootView[] } {
    return {
      roots: this.registry.list().map(workspace => ({
        rootId: String(workspace.id),
        path: workspace.path,
        title: workspace.title,
      })),
    }
  }

  /**
   * List the flat file inventory (gitignore-aware via git) plus uncommitted
   * statuses. A git-less root serves no files and reports `gitAvailable: false`.
   * @param request - root selection.
   * @returns tracked+untracked paths with worktree statuses.
   */
  @Remote('listTree')
  async listTree(request: TreeRequest): Promise<TreeResponse> {
    const root = await this.requireRoot(request.rootId)
    try {
      const [tracked, untracked, statusOutput] = await Promise.all([
        runGit(root.path, 'ls-files', { args: ['--cached', '-z'] }),
        runGit(root.path, 'ls-files', { args: ['--others', '--exclude-standard', '-z'] }),
        runGit(root.path, 'status', { args: ['--porcelain=v1', '-z'] }),
      ])
      const files = [...new Set([...splitNul(tracked), ...splitNul(untracked)])]
        .sort(comparePathSegments)
      const statuses = parsePorcelainZ(statusOutput).map(record => ({
        path: record.path,
        status: statusFromPorcelain(record.xy),
        ...(record.origPath !== undefined ? { oldPath: record.origPath } : {}),
      }))
      return { rootId: root.rootId, rootPath: root.path, files, statuses, gitAvailable: true }
    } catch (error) {
      if (!(error instanceof GitRunnerError)) throw error
      return { rootId: root.rootId, rootPath: root.path, files: [], statuses: [], gitAvailable: false }
    }
  }

  /**
   * Read the unified change ledger for one scope.
   * @param request - root plus scope kind and optional filters.
   * @returns change entries derived from the requested source.
   */
  @Remote('listChanges')
  async listChanges(request: ChangesRequest): Promise<{ readonly entries: readonly ChangeEntryView[] }> {
    const root = await this.requireRoot(request.rootId)
    switch (request.kind) {
      case 'session': return { entries: await this.sessionEntries(root, request.sessionId) }
      case 'worktree': return { entries: await this.worktreeEntries(root) }
      case 'commit': return { entries: await this.commitEntries(root) }
      /* v8 ignore next 2 -- strict wire schemas reject unknown kinds before dispatch */
      default: return { entries: [] }
    }
  }

  /**
   * Read one file's content at an optional revision; secrets are masked and
   * oversized texts truncate to their head window.
   * @param request - root, confined path, revision selector (`null` = working tree).
   * @returns text or binary view with size and digest.
   */
  @Remote('getFileContent')
  async getFileContent(request: FileContentRequest): Promise<FileContentView> {
    const root = await this.requireRoot(request.rootId)
    const target = await resolveInsideRoot(root.path, request.path)
    const rev = request.rev ?? null
    const bytes = rev === null
      ? await readFile(target)
      : await this.showBytes(root, target, rev)
    const size = bytes.byteLength
    const digest = sha256Hex(bytes)
    if (looksBinary(bytes)) {
      return {
        kind: 'binary',
        size,
        sha256: digest,
        masked: false,
        truncated: false,
        binaryNotice: `binary, ${size} bytes`,
      }
    }
    const windowed = size > MAX_FILE_READ_BYTES || size > MAX_DIFF_SIDE_BYTES
      ? bytes.subarray(0, MAX_FILE_READ_BYTES)
      : bytes
    const outcome = maskFileContent(target.slice(root.path.length + 1), decodeUtf8(windowed))
    return {
      kind: 'text',
      size,
      sha256: digest,
      masked: outcome.changed,
      text: outcome.masked,
      truncated: windowed.byteLength !== size,
    }
  }

  /**
   * Build the before→after diff for one file between revisions or for one
   * logged tool-call event's textual fragments. Oversized or binary material
   * degrades gracefully instead of failing.
   * @param request - shared rootId plus either file fields or tool-call fields.
   * @returns hunks, stats, and degradation flags.
   */
  @Remote('getDiff')
  async getDiff(request: DiffRequest): Promise<DiffResponse> {
    const root = await this.requireRoot(requireDefined(request.rootId, 'rootId'))
    return typeof request.seq === 'number' && typeof request.sessionId === 'string'
      ? this.toolCallDiff(root, request)
      : this.fileDiff(root, request)
  }

  /** Resolve the requested workspace root or refuse loudly. */
  private async requireRoot(rootId: string): Promise<{ rootId: string; path: string }> {
    const workspace = this.registry.list().find(candidate => String(candidate.id) === rootId)
    if (workspace === undefined) {
      throw new PathOutsideWorkspaceError(`unknown workspace root "${rootId}"`)
    }
    return { rootId: String(workspace.id), path: await realpathNormalize(workspace.path) }
  }

  /** Ledger over persisted sessions whose cwd equals the root. */
  private async sessionEntries(
    root: { readonly path: string },
    sessionIdFilter?: string,
  ): Promise<readonly ChangeEntryView[]> {
    const snapshots = await this.persistence.list()
    const collected: ChangeEntryView[] = []
    for (const { header } of snapshots) {
      if (typeof header.cwd !== 'string') continue
      if (await realpathNormalize(header.cwd) !== root.path) continue
      if (sessionIdFilter !== undefined && String(header.id) !== sessionIdFilter) continue
      const events = await this.readSessionEvents(header.id)
      collected.push(...foldSessionChanges({ id: String(header.id) }, root.path, events))
    }
    return collected.sort((left, right) => (right.at ?? '').localeCompare(left.at ?? ''))
  }

  /** Uncommitted statuses become ledger entries sized against the current disk. */
  private async worktreeEntries(
    root: { readonly path: string },
  ): Promise<readonly ChangeEntryView[]> {
    const statusOutput = await runGit(root.path, 'status', { args: ['--porcelain=v1', '-z'] })
    const entries: ChangeEntryView[] = []
    for (const record of parsePorcelainZ(statusOutput)) {
      let afterBytes: number | null = null
      try {
        const info = await stat(join(root.path, record.path))
        afterBytes = info.isFile() ? info.size : null
      } catch {
        // Deleted entries have nothing on disk; sizes stay unknown on purpose.
        afterBytes = null
      }
      entries.push({
        path: record.path,
        status: statusFromPorcelain(record.xy),
        ...(record.origPath !== undefined ? { oldPath: record.origPath } : {}),
        scope: 'worktree',
        beforeBytes: null,
        afterBytes,
        hunksCount: null,
      })
    }
    return entries
  }

  /** Recent commits become one entry per changed path. */
  private async commitEntries(
    root: { readonly path: string },
  ): Promise<readonly ChangeEntryView[]> {
    const output = await runGit(root.path, 'log', {
      args: ['-z', `-n${COMMIT_LEDGER_LIMIT}`, '--name-status', '--format=%x1e%H%x1f%cI'],
    })
    const entries: ChangeEntryView[] = []
    for (const block of output.split('\u001e')) {
      const parsed = parseLogBlock(block)
      if (parsed === undefined || parsed.oid.length === 0) continue
      for (const change of parsed.changes) {
        entries.push({
          path: change.path,
          status: change.status,
          ...(change.oldPath !== undefined ? { oldPath: change.oldPath } : {}),
          scope: 'commit',
          commitOid: parsed.oid,
          at: parsed.at,
          beforeBytes: null,
          afterBytes: null,
          hunksCount: null,
        })
      }
    }
    return entries
  }

  /**
   * Read one session's whole committed event log through a read handle,
   * closing it before returning. The DIF Explorer never appends; a read
   * handle is the read-only view the persistence seam now exposes in place
   * of the removed `inspect`.
   * @param id - the session to read.
   * @returns the session's committed events from seq 0.
   */
  private async readSessionEvents(id: SessionId): Promise<readonly SessionEvent[]> {
    const handle = await this.persistence.open(id, 'read')
    try {
      return await handle.read()
    } finally {
      await handle.close()
    }
  }

  /** Fragment diff of exactly one logged mutating tool call. */
  private async toolCallDiff(
    root: { readonly path: string },
    request: DiffRequest,
  ): Promise<DiffResponse> {
    const sessionId = requireDefined(request.sessionId, 'sessionId')
    const seq = requireDefined(request.seq, 'seq')
    const events = await this.readSessionEvents(sessionId as SessionId)
    const call = decodeMutatingCalls(events.map(asFoldable)).find(item => item.seq === seq)
    if (call === undefined) {
      throw new Error(`session "${sessionId}" holds no mutating tool call at seq ${seq}`)
    }
    const fragment = extractFragment(call, root.path)
    if (fragment === undefined) {
      throw new Error(`tool call ${seq} of session "${sessionId}" carries no usable text sides inside ${root.path}`)
    }
    return respondFragmentDiff(fragment.path, fragment.before, fragment.after)
  }

  /** Two-revision diff with graceful degradation for missing/binary/oversized sides. */
  private async fileDiff(
    root: { readonly path: string },
    request: DiffRequest,
  ): Promise<DiffResponse> {
    const target = await resolveInsideRoot(root.path, requireDefined(request.path, 'path'))
    const relative = target.slice(root.path.length + 1)
    const baseRev = request.base ?? 'HEAD'
    const headIsWorkingTree = request.head === undefined || request.head === null
    const baseSide = await this.readSide(root, target, baseRev)
    const headSide = headIsWorkingTree
      ? await diskReadOrEmpty(target)
      : await this.readSide(root, target, request.head)
    const oldBinary = baseSide.exists && looksBinary(baseSide.bytes)
    const newBinary = headSide.exists && looksBinary(headSide.bytes)
    if (oldBinary || newBinary) {
      return {
        oversized: false,
        binary: true,
        identical: false,
        truncated: false,
        additions: 0,
        deletions: 0,
        oldSize: baseSide.bytes.byteLength,
        newSize: headSide.bytes.byteLength,
        hunks: [],
      }
    }
    const oldSize = baseSide.bytes.byteLength
    const newSize = headSide.bytes.byteLength
    if (oldSize > MAX_DIFF_SIDE_BYTES || newSize > MAX_DIFF_SIDE_BYTES) {
      return await this.numstatStats(root, relative, baseSide.exists, oldSize, newSize)
    }
    const prepared = prepareSides(relative, baseSide.text, headSide.text)
    const built = buildHunks(prepared.oldText, prepared.newText)
    const capped = capRows(built.hunks, built.additions, built.deletions)
    return {
      oversized: false,
      binary: false,
      identical: prepared.identical,
      truncated: capped.truncated,
      additions: built.additions,
      deletions: built.deletions,
      oldSize: baseSide.exists ? oldSize : null,
      newSize: headSide.exists ? newSize : null,
      hunks: capped.hunks,
    }
  }

  /**
   * Oversized pairs degrade to numstat statistics only: no row content is
   * produced at all, so the payload stays bounded regardless of file size.
   */
  private async numstatStats(
    root: { readonly path: string },
    relative: string,
    baseExists: boolean,
    oldSize: number,
    newSize: number,
  ): Promise<DiffResponse> {
    const degraded: DiffResponse = {
      oversized: true,
      binary: false,
      identical: false,
      truncated: true,
      additions: 0,
      deletions: 0,
      oldSize: baseExists ? oldSize : null,
      newSize,
      hunks: [],
    }
    if (!baseExists) return degraded
    try {
      const numstat = await runGit(root.path, 'diff', { args: ['--numstat', '-z', '--', relative] })
      const row = parseNumstatZ(numstat).find(entry => entry.path === relative
        || entry.path.endsWith(relative))
      return row === undefined
        ? degraded
        : { ...degraded, additions: row.additions, deletions: row.deletions }
    } catch (error) {
      if (!(error instanceof GitRunnerError)) throw error
      return degraded
    }
  }

  /** One diff side through git; a side git does not know is empty, not fatal. */
  private async readSide(
    root: { readonly path: string },
    target: string,
    rev: string,
  ): Promise<{ exists: boolean; bytes: Uint8Array; text: string }> {
    try {
      const bytes = await runGit(root.path, 'show', {
        args: [`${rev}:${relativeUnder(root.path, target)}`],
        raw: true,
      })
      return { exists: true, bytes, text: decodeUtf8(bytes) }
    } catch (error) {
      if (!(error instanceof GitRunnerError)) throw error
      return { exists: false, bytes: new Uint8Array(), text: '' }
    }
  }

  /** Raw bytes of one revision-side content (`getFileContent`). */
  private async showBytes(
    root: { readonly path: string },
    target: string,
    rev: string,
  ): Promise<Uint8Array> {
    return runGit(root.path, 'show', {
      args: [`${rev}:${relativeUnder(root.path, target)}`],
      raw: true,
    })
  }
}

export default DifExplorerGateway

/* ── helpers ──────────────────────────────────────────────────────────────── */

/** Suffix of `target` below `root`; callers pass only confined targets. */
function relativeUnder(root: string, target: string): string {
  const rel = target.slice(root.length + 1)
  return rel.startsWith('/') ? rel.slice(1) : rel
}

/** Working-tree bytes, or empty when absent (created/deleted sides). */
async function diskReadOrEmpty(path: string): Promise<{ exists: boolean; bytes: Uint8Array; text: string }> {
  try {
    const bytes = await readFile(path)
    return { exists: true, bytes, text: decodeUtf8(bytes) }
  } catch {
    return { exists: false, bytes: new Uint8Array(), text: '' }
  }
}

/**
 * Fragment-mode response builder: mask both sides, build hunks, apply caps.
 * Sides are fragment-sized, so limits engage only on pathological edits.
 */
function respondFragmentDiff(relativePath: string, before: string | null, after: string | null): DiffResponse {
  const prepared = prepareSides(relativePath, before, after)
  const built = buildHunks(prepared.oldText, prepared.newText)
  const capped = capRows(built.hunks, built.additions, built.deletions)
  return {
    oversized: false,
    binary: false,
    identical: prepared.identical,
    truncated: capped.truncated,
    additions: built.additions,
    deletions: built.deletions,
    oldSize: before === null ? null : Buffer.byteLength(before, 'utf8'),
    newSize: Buffer.byteLength(after ?? '', 'utf8'),
    hunks: capped.hunks,
  }
}
