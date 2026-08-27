/**
 * Pure file-tree model for the Files tab: flat git path lists become
 * collapsible directory nodes, and a fuzzy query narrows them while keeping
 * ancestor directories visible.
 * @module dif-explorer-client/tree-model
 */

/** A node of the rendered tree (a directory or one file). */
export interface TreeNode {
  /** Display name (`src`, `index.ts`). */
  readonly name: string
  /** Full repo-relative forward-slash path (directories have no trailing slash). */
  readonly path: string
  readonly dir: boolean
  readonly children?: readonly TreeNode[]
}

/**
 * Build nested tree nodes from a sorted flat file list.
 * @param files - the flat path list, already sorted.
 * @returns the nested node tree rooted at an implicit root directory.
 */
export function buildTree(files: readonly string[]): readonly TreeNode[] {
  const rootChildren: TreeNode[] = []
  const dirIndex = new Map<string, TreeNode>([['', { name: '', path: '', dir: true, children: rootChildren }]])
  const ensureDir = (path: string): TreeNode => {
    const existing = dirIndex.get(path)
    if (existing !== undefined) return existing
    const slash = path.lastIndexOf('/')
    const parent = ensureDir(slash === -1 ? '' : path.slice(0, slash))
    const node: TreeNode = {
      name: slash === -1 ? path : path.slice(slash + 1),
      path,
      dir: true,
      children: [],
    }
    dirIndex.set(path, node)
    pushSorted(parent.children as TreeNode[], node)
    return node
  }
  const pushSorted = (into: TreeNode[], node: TreeNode): void => {
    let insertAt = into.length
    for (let i = 0; i < into.length; i++) {
      const other = into[i]
      if (other === undefined) break
      if (!other.dir && node.dir) { insertAt = i; break }
      if (other.dir === node.dir && other.name.localeCompare(node.name) > 0) { insertAt = i; break }
    }
    into.splice(insertAt, 0, node)
  }
  for (const file of files) {
    const slash = file.lastIndexOf('/')
    const parent = slash === -1 ? rootParent(rootChildren) : ensureDir(file.slice(0, slash))
    const leaf: TreeNode = { name: slash === -1 ? file : file.slice(slash + 1), path: file, dir: false }
    pushSorted(parent.children as TreeNode[], leaf)
  }
  return rootChildren
}

function rootParent(children: TreeNode[]): TreeNode {
  return { name: '', path: '', dir: true, children }
}

/**
 * Subsequence fuzziness with bonus for word starts; empty query matches all.
 * @param path - the target path text to score against.
 * @param query - the user's filter needle.
 * @returns a positive score, or null when the query does not match at all.
 */
export function fuzzyScore(path: string, query: string): number | null {
  if (query.length === 0) return 0
  const target = path.toLowerCase()
  const needle = query.toLowerCase()
  let score = 0
  let cursor = 0
  for (const ch of needle) {
    const found = target.indexOf(ch, cursor)
    if (found === -1) return null
    score += found === cursor ? 2 : 1
    if (found === 0 || target[found - 1] === '/' || target[found - 1] === '.') score += 3
    cursor = found + 1
  }
  // Shorter paths win ties.
  return score * 100 - Math.min(target.length, 99)
}

/**
 * Filter paths by the query then rebuild the tree from survivors.
 * @param files - the flat path list to filter.
 * @param query - the user's filter needle.
 * @returns matching paths in their input order.
 */
export function filterTreePaths(files: readonly string[], query: string): readonly string[] {
  if (query.trim().length === 0) return files
  return files.filter(path => fuzzyScore(path, query.trim()) !== null)
}
