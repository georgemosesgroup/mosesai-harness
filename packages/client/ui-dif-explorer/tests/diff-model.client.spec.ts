// Diff render model: unified/split assembly from one hunk source plus lazy
// intra-line fragments.
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { intraLine, rowsSplit, rowsUnified } from '../src/client/diff-model.ts'
import type { DiffRowView } from '@deepseek-ai/dsh-dif-explorer/types'

const hunkRows: DiffRowView[] = [
  { kind: 'context', oldNo: 1, newNo: 1, text: 'a' },
  { kind: 'del', oldNo: 2, text: 'old line' },
  { kind: 'add', newNo: 2, text: 'new line' },
  { kind: 'add', newNo: 3, text: 'added tail' },
]

describe('rowsUnified', () => {
  it('emits rows in wire order with hunk ordinals attached', () => {
    const rows = rowsUnified([hunkRows])
    expect(rows.map(row => row.kind)).toEqual(['context', 'del', 'add', 'add'])
    expect(rows.every(row => row.hunkIndex === 0)).toBe(true)
  })
})

describe('rowsSplit', () => {
  it('pairs the changed cluster one-to-one without padding here', () => {
    const pairs = rowsSplit([hunkRows])
    expect(pairs).toHaveLength(3)
    expect(pairs[1]).toMatchObject({ kind: 'change' })
    expect(pairs[1]?.left?.text).toBe('old line')
    expect(pairs[1]?.right?.text).toBe('new line')
  })

  it('pads the shorter side when del/add counts differ', () => {
    const pairs = rowsSplit([hunkRows.slice(1)])
    // One del row against two add rows: the cluster is as wide as its longer
    // side, so exactly one pad row closes the gap.
    expect(pairs).toHaveLength(2)
    expect(pairs[0]).toMatchObject({ kind: 'change', left: { text: 'old line' }, right: { text: 'new line' } })
    expect(pairs[1]).toMatchObject({ kind: 'padLeft', right: { text: 'added tail' } })
  })

  it('keeps context rows aligned on both sides', () => {
    const pairs = rowsSplit([[{ kind: 'context', oldNo: 9, newNo: 9, text: 'x' }]])
    expect(pairs).toHaveLength(1)
    expect(pairs[0]).toMatchObject({ kind: 'context', left: { oldNo: 9 }, right: { newNo: 9 } })
  })
})

describe('intraLine', () => {
  it('marks only the differing words of a changed pair', () => {
    const { left, right } = intraLine('const alpha = 1', 'const beta = 1')
    expect(left.filter(part => part.marked).map(part => part.text)).toEqual(['alpha'])
    expect(right.filter(part => part.marked).map(part => part.text)).toEqual(['beta'])
  })

  it('produces no marked parts for identical texts', () => {
    const { left, right } = intraLine('same text', 'same text')
    expect(left.every(part => !part.marked)).toBe(true)
    expect(right.every(part => !part.marked)).toBe(true)
  })
})
