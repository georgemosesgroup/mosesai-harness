import { describe, expect, it } from 'vitest'
import {
  ClaimConflictError,
  ClaimStore,
  globMatch,
  patternsOverlap,
} from '../src/claims-core.ts'

describe('claims-core', () => {
  it('glob matching', () => {
    expect(globMatch('a.md', 'a.md')).toBe(true)
    expect(globMatch('src/*.ts', 'src/deep/a.ts')).toBe(false)
    expect(globMatch('a/**/b', 'a/b')).toBe(true)
    expect(patternsOverlap('src/*.ts', 'src/b.md')).toBe(false)
    expect(patternsOverlap('pkg/**', 'pkg/r.md')).toBe(true)
  })

  it('store lifecycle', () => {
    const now = 1_000_000
    const s = new ClaimStore(() => now, { maxTtlMs: 120 * 60_000 })
    s.acquire({ sessionId: 'A', patterns: ['pkg/**'], ttlMs: 60_000, now })
    expect(() => s.acquire({ sessionId: 'B', patterns: ['pkg/x'], ttlMs: 60_000, now }))
      .toThrow(ClaimConflictError)
    expect(s.check('pkg/x.md', now)?.sessionId).toBe('A')
    s.release('A')
    expect(s.check('pkg/x.md', now)).toBeNull()
  })
})

describe('claims-core: absolute spellings (regression)', () => {
  it('identical absolute patterns overlap; child-of-absolute overlaps', () => {
    // Live regression: witnessesOf used to explode literal segments into
    // characters and dropped the leading slash, so `/x/**` vs `/x/**` was
    // judged disjoint and a foreign duplicate acquire slipped through.
    expect(patternsOverlap('/Volumes/w/.claim-test/**', '/Volumes/w/.claim-test/**')).toBe(true)
    expect(patternsOverlap('/Volumes/w/.claim-test/**', '/Volumes/w/.claim-test/a.md')).toBe(true)
    expect(patternsOverlap('/a/b', '/a/c')).toBe(false)
  })
})
