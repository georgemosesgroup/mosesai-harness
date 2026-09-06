/**
 * Read-only path confinement for one workspace root. Every filesystem access
 * the gateway performs funnels through {@link resolveInsideRoot}: the user path
 * is canonicalized and required to stay inside the canonical root, so `../`
 * traversal and symlink escapes are refused regardless of the caller's intent.
 * @module @deepseek-ai/dsh-dif-explorer/paths
 */

import { realpath } from 'node:fs/promises'
import { normalize, resolve, sep } from 'node:path'

/** A requested path resolves outside its workspace root. */
export class PathOutsideWorkspaceError extends Error {
  constructor(rootPath: string) {
    super(`path escapes the workspace root ${rootPath}`)
    this.name = 'PathOutsideWorkspaceError'
  }
}

/**
 * Lexically confined form of a client-supplied path against one root,
 * without touching the disk. Absolute inputs go through the same
 * containment test, so an absolute path outside the root is refused here too.
 * @param rootPath - canonical absolute workspace root directory.
 * @param userPath - client-supplied relative (or root-internal absolute) path.
 * @returns the confined relative path in forward-slash form ('' denotes the root itself).
 * @throws {PathOutsideWorkspaceError} when the lexically resolved target leaves the root.
 */
export function confinedRelativePath(rootPath: string, userPath: string): string {
  if (userPath.includes('\0')) throw new PathOutsideWorkspaceError(rootPath)
  const base = normalize(resolve(rootPath))
  // Trailing sep keeps `/root-evil` from matching the `/root` prefix.
  const prefix = `${base}${sep}`
  const candidate = normalize(resolve(base, userPath))
  if (candidate === base) return ''
  if (!candidate.startsWith(prefix)) throw new PathOutsideWorkspaceError(rootPath)
  return candidate.slice(prefix.length).split(sep).join('/')
}

/**
 * Canonicalize `userPath` against `root` and verify confinement twice:
 * lexically first (works for absent targets such as deleted files), then —
 * when the target exists — against its realpath, which closes symlink escapes.
 * The root itself is also canonicalized first, so a symlinked workspace path
 * (`/var` vs `/private/var` on macOS) does not misclassify honest targets.
 * @param root - canonical absolute workspace root directory.
 * @param userPath - client-supplied path, relative to the root or absolute inside it.
 * @returns the canonical absolute target inside the root.
 * @throws {PathOutsideWorkspaceError} when the path leaves the root by any mechanism.
 */
export async function resolveInsideRoot(root: string, userPath: string): Promise<string> {
  const lexicalBase = normalize(resolve(root))
  let base = lexicalBase
  try {
    base = await realpath(lexicalBase)
  } catch {
    // A vanished root fails downstream reads; lexical confinement still applies.
  }
  const lexical = resolve(base, confinedRelativePath(lexicalBase, userPath))
  try {
    const real = await realpath(lexical)
    return confineReal(real, base, lexicalBase)
  } catch (error) {
    if (isNotFound(error)) {
      // A prefix directory may exist under a different spelling than the root
      // input; confine what we can see and hand back the lexical form.
      return requireLexicalUnder(base, lexical) ?? lexical
    }
    throw error
  }
}

function requireLexicalUnder(base: string, candidate: string): string | undefined {
  if (candidate === base || candidate.startsWith(`${base}${sep}`)) return candidate
  throw new PathOutsideWorkspaceError(base)
}

function confineReal(real: string, base: string, originalRoot: string): string {
  if (real === base || real.startsWith(`${base}${sep}`)) return real
  throw new PathOutsideWorkspaceError(originalRoot)
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && (error as { code?: unknown }).code === 'ENOENT'
}
