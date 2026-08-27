// Tree model behavior: nested building with dirs-first order, fuzzy ranking,
// and query filtering that keeps survivors tree-consistent.
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { buildTree, filterTreePaths, fuzzyScore } from '../src/client/tree-model.ts'

describe('buildTree', () => {
  it('nests files under directories with dirs-first ordering', () => {
    const nodes = buildTree([
      'z.ts',
      'src/deep/a.ts',
      'src/b.ts',
      'README.md',
    ])
    expect(nodes.map(node => node.name)).toEqual(['src', 'README.md', 'z.ts'])
    const src = nodes.find(node => node.name === 'src')
    expect(src?.dir).toBe(true)
    expect(src?.children?.map(child => child.name)).toEqual(['deep', 'b.ts'])
  })

  it('keeps duplicate directory segments in separate paths distinct', () => {
    const nodes = buildTree(['a/x.ts', 'a/y/x.ts'])
    expect(nodes).toHaveLength(1)
    expect(nodes[0]?.path).toBe('a')
  })
})

describe('fuzzyScore', () => {
  it('matches everything on an empty query', () => {
    expect(fuzzyScore('any/path.ts', '')).toBe(0)
  })

  it('rewards boundary-aligned contiguity above separated interiors', () => {
    const aligned = fuzzyScore('assets/readme.md', 'read')
    const separated = fuzzyScore('xrxexaxdxxxx.mdxx', 'read')
    expect(aligned).not.toBeNull()
    expect(separated).not.toBeNull()
    expect(aligned!).toBeGreaterThan(separated!)
  })

  it('rejects non-subsequences', () => {
    expect(fuzzyScore('abc.ts', 'zz')).toBeNull()
  })
})

describe('filterTreePaths', () => {
  const files = ['src/index.ts', 'src/ui/theme.css', 'assets/readme.md']

  it('passes the list through untouched for blank queries', () => {
    expect(filterTreePaths(files, '   ')).toEqual(files)
  })

  it('drops paths that do not fuzzily match', () => {
    const kept = filterTreePaths(files, 'themcss'.slice(0, 5))
    expect(kept).toContain('src/ui/theme.css')
    expect(kept).not.toContain('assets/readme.md')
  })
})
