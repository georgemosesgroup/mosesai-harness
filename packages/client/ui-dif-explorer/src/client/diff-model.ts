/**
 * Pure diff-render model shared by the split and unified viewers. Both views
 * derive from the same hunk wire rows, so they can never disagree; intra-line
 * highlighting is computed lazily over changed row pairs via jsdiff's
 * word-with-space granularity and cached by caller-supplied memo map identity.
 * @module dif-explorer-client/diff-model
 */

import { diffWordsWithSpace } from 'diff'

import type { DiffRowView } from '@deepseek-ai/dsh-dif-explorer/types'

/** Cached intra-line result for one changed pair. */
interface IntraPair {
  readonly left: readonly IntraPart[]
  readonly right: readonly IntraPart[]
}

const intraCache = new Map<string, IntraPair>()

/** One rendered line in either view mode. */
export interface RenderRow {
  readonly kind: 'context' | 'del' | 'add' | 'collapsed'
  readonly oldNo?: number
  readonly newNo?: number
  readonly text: string
  /** Hunk ordinal this row belongs to (for sticky headers / j-k navigation). */
  readonly hunkIndex?: number
}

/** A collapsed unchanged zone placeholder between hunks. */
export interface CollapsedZone {
  /** Rows hidden above/below the boundary within the SAME side's numbering space. */
  readonly up: number
  readonly down: number
  /** Absolute old-side start line of the hidden run (for expand requests). */
  readonly oldFrom?: number
  readonly oldTo?: number
  readonly newFrom?: number
  readonly newTo?: number
}

/**
 * Unified order: del before add inside each change cluster.
 * @param hunks - per-hunk row groups in diff order.
 * @returns the interleaved render rows.
 */
export function rowsUnified(hunks: readonly DiffRowView[][]): RenderRow[] {
  const out: RenderRow[] = []
  hunks.forEach((hunkRows, hunkIndex) => {
    for (const row of hunkRows) {
      out.push({
        kind: row.kind,
        ...(row.oldNo !== undefined ? { oldNo: row.oldNo } : {}),
        ...(row.newNo !== undefined ? { newNo: row.newNo } : {}),
        text: row.text,
        hunkIndex,
      })
    }
  })
  return out
}

/** One aligned side-by-side pair; the shorter side pads with empty rows. */
export interface SplitPair {
  readonly left?: DiffRowView
  readonly right?: DiffRowView
  readonly kind: 'context' | 'change' | 'padLeft' | 'padRight'
}

/**
 * Walk each hunk once, pairing consecutive del+add clusters one-to-one and
 * padding remainder sides, exactly like GitHub's split panes.
 * @param hunks - per-hunk row groups in diff order.
 * @returns side-paired rows for the split panes.
 */
export function rowsSplit(hunks: readonly DiffRowView[][]): SplitPair[] {
  const pairs: SplitPair[] = []
  for (const hunkRows of hunks) {
    let index = 0
    while (index < hunkRows.length) {
      const row = hunkRows[index]
      if (row === undefined) break
      if (row.kind === 'context') {
        pairs.push({ left: row, right: row, kind: 'context' })
        index++
        continue
      }
      const dels: DiffRowView[] = []
      const adds: DiffRowView[] = []
      for (;;) {
        const row = hunkRows[index]
        if (row === undefined || row.kind !== 'del') break
        dels.push(row)
        index++
      }
      for (;;) {
        const row = hunkRows[index]
        if (row === undefined || row.kind !== 'add') break
        adds.push(row)
        index++
      }
      const width = Math.max(dels.length, adds.length)
      for (let offset = 0; offset < width; offset++) {
        const left = dels[offset]
        const right = adds[offset]
        pairs.push({
          ...(left !== undefined ? { left } : {}),
          ...(right !== undefined ? { right } : {}),
          kind: left === undefined && right === undefined
            ? 'context'
            : left === undefined ? 'padLeft' : right === undefined ? 'padRight' : 'change',
        })
      }
    }
  }
  return pairs
}

/** One highlighted fragment of an intra-line diff. */
export interface IntraPart {
  readonly text: string
  readonly marked: boolean
}

/**
 * Intra-line fragments of one changed pair, cached per pair-text key so
 * scrolling never recomputes word diffs. Equal fragments stay unmarked;
 * changed runs carry `marked`.
 * @param leftText - the removed-side line text.
 * @param rightText - the added-side line text.
 * @returns cached fragment pair with marked runs.
 */
export function intraLine(leftText: string, rightText: string): IntraPair {
  const key = `${leftText}\u0000${rightText}`
  const hit = intraCache.get(key)
  if (hit !== undefined) return hit
  const parts = diffWordsWithSpace(leftText.replace(/\n$/, ''), rightText.replace(/\n$/, ''))
  const left: IntraPart[] = []
  const right: IntraPart[] = []
  for (const part of parts) {
    if (part.added) right.push({ text: part.value, marked: true })
    else if (part.removed) left.push({ text: part.value, marked: true })
    else {
      left.push({ text: part.value, marked: false })
      right.push({ text: part.value, marked: false })
    }
  }
  const built = { left, right }
  if (intraCache.size > 4096) intraCache.clear()
  intraCache.set(key, built)
  return built
}
