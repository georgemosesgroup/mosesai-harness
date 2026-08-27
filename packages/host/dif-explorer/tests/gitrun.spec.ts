// Git runner: parse-only helpers plus the allowlist boundary that refuses
// non-read commands before any process can spawn.
import { describe, expect, it } from 'vitest'
import {
  parseLogBlock,
  parseNumstatZ,
  parsePorcelainZ,
  runGit,
  statusFromPorcelain,
} from '../src/gitrun.ts'

const tmpRoot = '/tmp' // never used by refused calls; harmless for allowlist tests

describe('runGit allowlist', () => {
  it('rejects mutating subcommands before spawning anything', async () => {
    await expect(runGit(tmpRoot, 'push', {})).rejects.toThrow(/allowlist/)
    await expect(runGit(tmpRoot, 'commit', { args: ['-m'] })).rejects.toThrow(/allowlist/)
    await expect(runGit(tmpRoot, 'reset', {})).rejects.toThrow(/allowlist/)
  })

  it('allows listed read-only subcommands to attempt execution against a bad repo dir', async () => {
    await expect(runGit(tmpRoot, 'status', {})).rejects.toThrow(/failed|not a git repository/i)
  })
})

describe('statusFromPorcelain', () => {
  it('maps XY pairs onto the four wire letters with the index side winning', () => {
    expect(statusFromPorcelain('??')).toBe('A')
    expect(statusFromPorcelain('A ')).toBe('A')
    expect(statusFromPorcelain('.M')).toBe('M')
    expect(statusFromPorcelain('D ')).toBe('D')
    expect(statusFromPorcelain('R ')).toBe('R')
    expect(statusFromPorcelain('MM')).toBe('M')
  })
})

describe('parsePorcelainZ', () => {
  it('parses plain entries and rename pairs out of NUL-separated porcelain v1', () => {
    const raw = '.M src/a.ts\0?? new.md\0R  renamed.ts\0old-name.ts\0'
    const records = parsePorcelainZ(raw)
    expect(records).toEqual([
      { xy: '.M', path: 'src/a.ts' },
      { xy: '??', path: 'new.md' },
      { xy: 'R ', path: 'renamed.ts', origPath: 'old-name.ts' },
    ])
  })
})

describe('parseNumstatZ', () => {
  it('reads numeric and binary rows', () => {
    const rows = parseNumstatZ('\n5\t2\tfile-a.txt\0-\t-\tpic.png\0')
    expect(rows).toEqual([
      { additions: 5, deletions: 2, path: 'file-a.txt' },
      { additions: 0, deletions: 0, path: 'pic.png' },
    ])
  })
})

describe('parseLogBlock', () => {
  it('extracts oid, ISO date, and name-status changes including renames', () => {
    const block = '\u001e0000000000000000000000000000000000000000\u001f2026-08-26T12:00:00.000Z\nA\u0000notes/new.txt\u0000M\u0000src/main.ts\u0000R\u0000old.ts\u0000new.ts\u0000'
    const parsed = parseLogBlock(block)
    expect(parsed?.oid).toHaveLength(40)
    expect(parsed?.at).toBe('2026-08-26T12:00:00.000Z')
    expect(parsed?.changes).toEqual([
      { status: 'A', path: 'notes/new.txt' },
      { status: 'M', path: 'src/main.ts' },
      { status: 'R', path: 'new.ts', oldPath: 'old.ts' },
    ])
  })

  it('returns nothing for blank blocks', () => {
    expect(parseLogBlock('\n\n')).toBeUndefined()
  })
})
