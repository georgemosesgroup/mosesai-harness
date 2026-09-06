// Hunk model: jsdiff output shaped into numbered wire rows, limits, binary
// detection, and masked side preparation.
import { describe, expect, it } from 'vitest'
import { buildHunks, capRows, countChangedRows, looksBinary, MAX_DIFF_ROWS, prepareSides } from '../src/difflib.ts'

describe('buildHunks', () => {
  it('numbers context and changed rows GitHub-style on both sides', () => {
    const { hunks } = buildHunks('a\nb\nc\n', 'a\nB2\nc\nd\n')
    expect(hunks).toHaveLength(1)
    const rows = hunks[0]?.rows ?? []
    expect(rows.map(row => [row.kind, row.oldNo, row.newNo])).toEqual([
      ['context', 1, 1],
      ['del', 2, undefined],
      ['add', undefined, 2],
      ['context', 3, 3],
      ['add', undefined, 4],
    ])
    expect(hunks[0]).toMatchObject({ oldStart: 1, oldLines: 3, newStart: 1, newLines: 4 })
  })

  it('accumulates additions/deletions across a merged hunk', () => {
    const { hunks, additions, deletions } = buildHunks('x\ny\nz\n', 'y\n')
    expect(hunks.length).toBeGreaterThanOrEqual(1)
    expect(additions).toBe(0)
    expect(deletions).toBe(2)
  })

  it('treats missing sides as empty content (created or deleted file)', () => {
    const created = buildHunks('', 'new line\n')
    expect(created.additions).toBe(1)
    expect(created.deletions).toBe(0)
    const deleted = buildHunks('gone\n', '')
    expect(deleted.additions).toBe(0)
    expect(deleted.deletions).toBe(1)
  })

  it('produces zero hunks for identical text', () => {
    expect(buildHunks('same\n', 'same\n').hunks).toHaveLength(0)
  })
})

describe('countChangedRows', () => {
  it('counts non-context rows only', () => {
    expect(countChangedRows('a\nb\n', 'a\nc\n')).toBe(2)
    expect(countChangedRows('same\n', 'same\n')).toBe(0)
  })
})

describe('capRows', () => {
  it('keeps everything under the cap untruncated', () => {
    const { hunks } = buildHunks('a\nb\n', 'a\nc\n')
    expect(capRows(hunks, 1, 1)).toEqual({ hunks, truncated: false })
  })

  it('truncates the tail when rows exceed the cap', () => {
    // Isolated changes spaced beyond the context window keep the hunks
    // separate, so the row count scales past MAX_DIFF_ROWS.
    const baseLines = Array.from({ length: 7000 }, (_, i) => (i % 10 === 0 ? `line ${i}` : `filler ${i}`))
    const modded = baseLines.map(line => line.startsWith('line ') ? `${line} edited` : line)
    const built = buildHunks(`${baseLines.join('\n')}\n`, `${modded.join('\n')}\n`)
    const capped = capRows(built.hunks, built.additions, built.deletions)
    const totalRows = capped.hunks.reduce((sum, hunk) => sum + hunk.rows.length, 0)
    expect(capped.truncated).toBe(true)
    expect(totalRows).toBeLessThanOrEqual(MAX_DIFF_ROWS)
  })
})

describe('looksBinary', () => {
  it.each([
    [new Uint8Array([104, 101, 108, 108, 111]), false],
    [new Uint8Array([104, 0, 108]), true],
    [new Uint8Array(Array.from({ length: 100 }, (_, i) => (i % 2 === 0 ? 1 : 65))), true],
  ])('judges binary-looking bytes as binary', (bytes, expected) => {
    expect(looksBinary(bytes)).toBe(expected)
  })

  it('allows an ordinary utf-8 window through', () => {
    const bytes = new TextEncoder().encode('# заголовок\nтекст документа…\n'.repeat(50))
    expect(looksBinary(bytes)).toBe(false)
  })
})

describe('prepareSides', () => {
  it('reports identity after masking and flags secret-file withholding', () => {
    const sameSecret = prepareSides('.env', 'A=1\nB=2\n', 'A=1\nC=3\n')
    expect(sameSecret.masked).toBe(true)
    expect(sameSecret.identical).toBe(true) // both collapse to the withheld notice
    const plain = prepareSides('src/a.ts', 'one\n', 'two\n')
    expect(plain.masked).toBe(false)
    expect(plain.identical).toBe(false)
  })
})
