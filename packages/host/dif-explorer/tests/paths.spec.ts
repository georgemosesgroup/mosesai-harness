// Path confinement: lexical traversal and symlink escapes both refuse.
import { mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { confinedRelativePath, PathOutsideWorkspaceError, resolveInsideRoot } from '../src/paths.ts'

const roots: string[] = []

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dif-explorer-paths-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('confinedRelativePath', () => {
  it('accepts plain relatives and nested traversal that stays inside', () => {
    expect(confinedRelativePath('/w', 'src/index.ts')).toBe('src/index.ts')
    expect(confinedRelativePath('/w', 'src/../README.md')).toBe('README.md')
    expect(confinedRelativePath('/w', '.')).toBe('')
  })

  it.each([
    ['../../etc/passwd'],
    ['a/../../outside.txt'],
    ['/etc/passwd'],
    ['\0hidden'],
  ])('rejects %j lexically', (userPath) => {
    expect(() => confinedRelativePath('/Volumes/ws', userPath)).toThrow(PathOutsideWorkspaceError)
  })

  it('refuses prefix lookalikes (root-evil vs root)', () => {
    expect(() => confinedRelativePath('/Volumes/ws', '../ws-evil/file')).toThrow(PathOutsideWorkspaceError)
  })
})

describe('resolveInsideRoot', () => {
  it('canonicalizes an existing file path under the root', async () => {
    const root = await makeRoot()
    await writeFile(join(root, 'file.txt'), 'x')
    const resolved = await resolveInsideRoot(root, './file.txt')
    expect(resolved.startsWith(await realpathOf(root))).toBe(true)
  })

  it('returns the lexical target for absent files (deleted entries stay diffable)', async () => {
    const root = await makeRoot()
    const resolved = await resolveInsideRoot(root, 'gone/deleted.ts')
    expect(resolved.endsWith('gone/deleted.ts')).toBe(true)
  })

  it('blocks a symlink that resolves outside the workspace', async () => {
    const root = await makeRoot()
    const outside = await mkdtemp(join(tmpdir(), 'dif-explorer-outside-'))
    roots.push(outside)
    await writeFile(join(outside, 'secret.txt'), 'nope')
    await symlink(join(outside, 'secret.txt'), join(root, 'escape.lnk'))
    await expect(resolveInsideRoot(root, 'escape.lnk')).rejects.toThrow(PathOutsideWorkspaceError)
  })

  it('allows subdirectories to exist yet reject their escaped children', async () => {
    const root = await makeRoot()
    await mkdir(join(root, 'sub'))
    await expect(resolveInsideRoot(root, 'sub/../../../etc/passwd')).rejects.toThrow(PathOutsideWorkspaceError)
  })
})

async function realpathOf(path: string): Promise<string> {
  const { realpath } = await import('node:fs/promises')
  return realpath(path)
}
