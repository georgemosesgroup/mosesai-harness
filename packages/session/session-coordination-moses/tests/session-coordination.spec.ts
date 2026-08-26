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
    expect(patternsOverlap('docs/**', 'docs/r.md')).toBe(true)
  })

  it('store lifecycle', () => {
    const now = 1_000_000
    const s = new ClaimStore(() => now, { maxTtlMs: 120 * 60_000 })
    s.acquire({ sessionId: 'A', patterns: ['docs/**'], ttlMs: 60_000, now })
    expect(() => s.acquire({ sessionId: 'B', patterns: ['docs/x'], ttlMs: 60_000, now }))
      .toThrow(ClaimConflictError)
    expect(s.check('docs/x.md', now)?.sessionId).toBe('A')
    s.release('A')
    expect(s.check('docs/x.md', now)).toBeNull()
  })
})
