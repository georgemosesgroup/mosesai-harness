/** Wire vocabulary of the DIF Explorer Remote. Types only — the runtime lives
 * in the gateway and its helper modules. Every field must stay JSON-representable:
 * these values cross the API Gateway as strict-schema payloads.
 * @module @deepseek-ai/dsh-dif-explorer/types
 */

/** Git-style change status of one path. */
export type ChangeStatus = 'A' | 'M' | 'D' | 'R'

/** Where a change entry was derived from. */
export type ChangeScope = 'session' | 'worktree' | 'commit'

/** One workspace root exposed to trusted clients. */
export interface WorkspaceRootView {
  /** Stable registry id (opaque to clients; echoed back on every call). */
  readonly rootId: string
  /** Canonical absolute directory path of the root. */
  readonly path: string
  /** Display title. */
  readonly title: string
}

/** Request for {@link listTree}. */
export interface TreeRequest {
  /** Workspace root id as returned by `listRoots`. */
  readonly rootId: string
}

/** Worktree status of one path (uncommitted view, untracked included). */
export interface WorktreeStatusView {
  readonly path: string
  readonly status: ChangeStatus
  /** Previous path when status is `R` (a rename or a copy). */
  readonly oldPath?: string
}

/** Response for {@link listTree}. */
export interface TreeResponse {
  readonly rootId: string
  /** Root that served the request. */
  readonly rootPath: string
  /**
   * Flat git-tracked-plus-untracked file list, relative to the root,
   * forward-slash separated. Directories are derived by the client;
   * respecting `.gitignore` is delegated to git.
   */
  readonly files: readonly string[]
  /** Uncommitted statuses joined onto the tree (empty without git). */
  readonly statuses: readonly WorktreeStatusView[]
  /** False when the root holds no usable repository. */
  readonly gitAvailable: boolean
}

/** Scope selector of {@link listChanges}. All fields other than `kind` are optional filters. */
export interface ChangesRequest {
  readonly rootId: string
  /** Which ledger to read. */
  readonly kind: ChangeScope
  /** Session scope: limit to this session id instead of every root session. */
  readonly sessionId?: string
}

/** One change record in the unified ledger model. */
export interface ChangeEntryView {
  readonly path: string
  readonly status: ChangeStatus
  /** Previous path when status is `R`. */
  readonly oldPath?: string
  readonly scope: ChangeScope
  /** Session scope only. */
  readonly sessionId?: string
  /** Commit scope only. */
  readonly commitOid?: string
  /** Logged tool name for session entries (`write`, `edit`, ...). */
  readonly tool?: string
  /** Log seq of the source `tool/call` event (session entries only). */
  readonly seq?: number
  /** ISO-8601 instant: log time for sessions, commit time for commits; absent for worktree. */
  readonly at?: string
  /** Byte size before the change; null when unknowable from the source alone. */
  readonly beforeBytes: number | null
  /** Byte size after the change; null when not derivable. */
  readonly afterBytes: number | null
  /** Hunk count computed over the available before/after text; null when nothing textual exists. */
  readonly hunksCount: number | null
}

/** Request for {@link getFileContent}. */
export interface FileContentRequest {
  readonly rootId: string
  /** Path relative to the root (or an absolute path inside the root). */
  readonly path: string
  /** Revision selector: `null` reads the working tree, a rev reads `git show <rev>:<path>`. */
  readonly rev?: string | null
}

/** Content of one file at one revision, secrets masked host-side. */
export interface FileContentView {
  readonly kind: 'text' | 'binary'
  readonly size: number
  readonly sha256: string
  /** True when at least part of the returned text replaces matched secret material. */
  readonly masked: boolean
  /** Present for text content; truncated when the file exceeds the size cap. */
  readonly text?: string
  readonly truncated: boolean
  /** Present with `binary: true` plus the byte size. */
  readonly binaryNotice?: string
}

/**
 * Diff target. Either a file between two revisions (defaults: base `HEAD`,
 * head working tree) or one logged tool-call event's before/after fragments.
 */
export interface DiffRequest {
  /** The workspace root (file mode). */
  readonly rootId?: string
  /** The file path (file mode). */
  readonly path?: string
  /** Base revision (file mode); default `HEAD`. */
  readonly base?: string | null
  /** Head revision (file mode); default the working tree. */
  readonly head?: string | null
  /** The owning session (tool-call mode). */
  readonly sessionId?: string
  /** Log seq of the `tool/call` event (tool-call mode). */
  readonly seq?: number
}

/** One unified-diff row with both sides' line numbers where defined. */
export interface DiffRowView {
  readonly kind: 'context' | 'del' | 'add'
  /** 1-based old-side line number for context/del rows. */
  readonly oldNo?: number
  /** 1-based new-side line number for context/add rows. */
  readonly newNo?: number
  /** Row text without any diff marker; masked host-side. */
  readonly text: string
}

/** One hunk: header positions plus its rows. */
export interface DiffHunkView {
  readonly oldStart: number
  readonly oldLines: number
  readonly newStart: number
  readonly newLines: number
  readonly rows: readonly DiffRowView[]
}

/** Response for {@link getDiff}. */
export interface DiffResponse {
  /** The file (or either side) exceeds a hard limit; hunks are omitted. */
  readonly oversized: boolean
  /** Either side detected as binary; hunks are omitted. */
  readonly binary: boolean
  /** Both sides resolved but their text is identical. */
  readonly identical: boolean
  /** True when `rows` were cut by the row cap (the tail is not included). */
  readonly truncated: boolean
  readonly additions: number
  readonly deletions: number
  readonly oldSize: number | null
  readonly newSize: number | null
  readonly hunks: readonly DiffHunkView[]
}
