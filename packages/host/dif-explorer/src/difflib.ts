/**
 * Diff computation over two text sides plus binary detection and size caps.
 * jsdiff owns the algorithm (`structuredPatch`); this module only shapes its
 * output into the wire vocabulary, masks secrets on the way out, and applies
 * the graceful-degradation limits.
 * @module @deepseek-ai/dsh-dif-explorer/difflib
 */

import { createHash } from 'node:crypto'
import { structuredPatch } from 'diff'
import type { DiffHunkView, DiffRowView } from './types.ts'
import { maskFileContent } from './secrets.ts'

/** Unified context lines shown around each change cluster. */
const DIFF_CONTEXT = 3

/** Files above one byte are 1 MiB in either side refuse hunk rendering. */
export const MAX_DIFF_SIDE_BYTES = 1024 * 1024

/** Unified rows beyond this cap truncate the response tail. */
export const MAX_DIFF_ROWS = 5000

/** First-render budget applied client-side too; the host caps rows well above it. */
export const RENDER_ROW_BUDGET = 500

/** File reads past this cap return head-only text with `truncated`. */
export const MAX_FILE_READ_BYTES = 512 * 1024

/** Outcome of preparing both sides for a textual diff. */
export interface PreparedSides {
  readonly oldText: string
  readonly newText: string
  readonly identical: boolean
  /** True when either side matched the secret-file name policy before masking. */
  readonly masked: boolean
}

/**
 * Detect non-text bytes: a NUL anywhere or over 30% control bytes in the
 * inspected window marks a binary artifact.
 * @param buffer - the file bytes to inspect.
 * @returns true when the content should never be rendered as text.
 */
export function looksBinary(buffer: Uint8Array): boolean {
  const window = buffer.subarray(0, 8192)
  if (window.length === 0) return false
  let suspicious = 0
  for (const byte of window) {
    if (byte === 0) return true
    // Tab/LF/CR and printable bytes count as text; other controls signal binary.
    if (byte < 9 || (byte > 13 && byte < 32)) suspicious++
  }
  return suspicious * 10 >= window.length * 3
}

/**
 * SHA-256 over bytes, hex-encoded.
 * @param buffer - the bytes to hash.
 * @returns the hex-encoded digest.
 */
export function sha256Hex(buffer: Uint8Array): string {
  return createHash('sha256').update(buffer).digest('hex')
}

/**
 * Mask each side through the secret policy. Secrets files collapse to a
 * notice; everything else gets content-pattern masking. An all-masked result
 * of a secrets file still diffs (usually "identical"), which is honest.
 * @param path - path both sides belong to.
 * @param oldText - prior-side text ('' when absent).
 * @param newText - next-side text ('' when absent).
 * @returns prepared sides with masking applied and identity judged AFTER masking.
 */
export function prepareSides(path: string, oldText: string | null, newText: string | null): PreparedSides {
  const oldMasked = maskFileContent(path, oldText ?? '')
  const newMasked = maskFileContent(path, newText ?? '')
  return {
    oldText: oldMasked.masked,
    newText: newMasked.masked,
    identical: oldMasked.masked === newMasked.masked,
    masked: oldMasked.changed || newMasked.changed,
  }
}

/**
 * Build unified hunks with both sides' line numbers from jsdiff's structured
 * patch. Row numbers follow GitHub semantics: del rows carry only the old
 * number, add rows only the new one.
 * @param oldText - masked prior text ('' allowed).
 * @param newText - masked next text ('' allowed).
 * @returns hunks in file order plus cumulative stats.
 */
export function buildHunks(oldText: string, newText: string): {
  readonly hunks: readonly DiffHunkView[]
  readonly additions: number
  readonly deletions: number
} {
  const patch = structuredPatch(
    'a',
    'b',
    oldText,
    newText,
    undefined,
    undefined,
    { context: DIFF_CONTEXT },
  )
  const hunks: DiffHunkView[] = []
  let additions = 0
  let deletions = 0
  for (const hunk of patch.hunks) {
    const rows: DiffRowView[] = []
    let oldNo = hunk.oldStart
    let newNo = hunk.newStart
    for (const line of hunk.lines) {
      const marker = line.charAt(0)
      const text = line.slice(1)
      if (marker === '+') {
        rows.push({ kind: 'add', newNo, text })
        newNo++
        additions++
      } else if (marker === '-') {
        rows.push({ kind: 'del', oldNo, text })
        oldNo++
        deletions++
      } else if (marker === ' ') {
        rows.push({ kind: 'context', oldNo, newNo, text })
        oldNo++
        newNo++
      } else if (marker === '\\') {
        // The "\ No newline at end of file" line annotates the patch, not the
        // content; following the repository diff-card rule, it is skipped.
        continue
      }
    }
    hunks.push({
      oldStart: hunk.oldStart,
      oldLines: hunk.oldLines,
      newStart: hunk.newStart,
      newLines: hunk.newLines,
      rows,
    })
  }
  return { hunks, additions, deletions }
}

/**
 * Count change rows cheaply without materializing hunk objects (ledger scan use).
 * @param oldText - the prior content, when it exists.
 * @param newText - the new content.
 * @returns the number of non-context rows across all hunks.
 */
export function countChangedRows(oldText: string, newText: string): number {
  return buildHunks(oldText, newText).hunks.reduce(
    (sum, hunk) => sum + hunk.rows.filter(row => row.kind !== 'context').length,
    0,
  )
}

/**
 * Apply the response limits: no sides over {@link MAX_DIFF_SIDE_BYTES}, no more
 * than {@link MAX_DIFF_ROWS} emitted rows. Oversized/binary decisions must be
 * made by the caller before this point.
 * @param hunks - built hunks for the request.
 * @param additions - computed addition count.
 * @param deletions - computed deletion count.
 * @returns rows possibly truncated with `truncated` reflecting whether any content was cut.
 */
export function capRows(hunks: readonly DiffHunkView[], additions: number, deletions: number): {
  readonly hunks: readonly DiffHunkView[]
  readonly truncated: boolean
} {
  let total = 0
  const capped: DiffHunkView[] = []
  for (const hunk of hunks) {
    const room = MAX_DIFF_ROWS - total
    if (room <= 0) {
      return { hunks: capped, truncated: true }
    }
    if (hunk.rows.length <= room) {
      total += hunk.rows.length
      capped.push(hunk)
    } else {
      capped.push({ ...hunk, rows: hunk.rows.slice(0, room) })
      return { hunks: capped, truncated: true }
    }
  }
  void additions
  void deletions
  return { hunks: capped, truncated: false }
}
