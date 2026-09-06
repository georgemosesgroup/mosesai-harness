/**
 * DIF Explorer view: the conversation.view tab over the read-only Remote
 * gateway. Components are pure props consumers — every Remote call arrives
 * through the injected `api` callbacks, and all viewer state here is
 * component-local presentation state (the slot's contract carries no store;
 * the ui-trajectory entry follows the same pattern with its own sources).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  ChangeEntryView,
  ChangeStatus,
  DiffRequest,
  DiffResponse,
  TreeResponse,
  WorkspaceRootView,
} from '@deepseek-ai/dsh-dif-explorer/types'
import { Button, Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import { buildTree, filterTreePaths, type TreeNode } from './tree-model.ts'
import { intraLine, rowsSplit, rowsUnified } from './diff-model.ts'
import css from './dif.module.css'

/** Inject face closed over the plugin apply ctx: typed Remote wrappers. */
export interface DifExplorerInjected {
  readonly api: {
    listRoots: () => Promise<{ roots: readonly WorkspaceRootView[] }>
    listTree: (rootId: string) => Promise<TreeResponse>
    listChanges: (
      rootId: string,
      kind: 'session' | 'worktree' | 'commit',
    ) => Promise<{ entries: readonly ChangeEntryView[] }>
    getFileContent: (
      rootId: string,
      path: string,
      rev?: string | null,
    ) => Promise<FileContentLike>
    getDiff: (request: DiffRequest) => Promise<DiffResponse>
  }
}

/** The slice of FileContentView the viewer pane consumes. */
interface FileContentLike {
  readonly kind: 'text' | 'binary'
  readonly size: number
  readonly sha256: string
  readonly masked: boolean
  readonly text?: string | undefined
  readonly truncated: boolean
  readonly binaryNotice?: string | undefined
}

/** Which list tab is visible inside the surface. */
type Tab = 'files' | 'changes'

/** Which change ledger the Changes tab reads. */
type Scope = 'session' | 'worktree' | 'commit'

/** Full props of the view entry: runtime kit + inject + locale seat. */
export type DifExplorerProps =
  & ConvViewProps
  & InjectFace<DifExplorerInjected>
  & PropsLocale<'difExplorer'>

/** Rows rendered before the cap asks the reader to narrow the view. */
const RENDER_CAP_ROWS = 500

const DATA_HUNK_INDEX = 'data-hunk-index'

const SPLIT_PREF_KEY = 'dsh.dif-explorer.split'

/** The locale seat's translate shape narrowed to this namespace. */
type Translate = PropsLocale<'difExplorer'>['t']

/** Component-local viewer state shared by the panes below. */
interface ViewerState {
  roots: readonly WorkspaceRootView[]
  rootId: string | null
  tree: TreeResponse | null
  tab: Tab
  scope: Scope
  statusFilter: string
  toolFilter: string
  pathFilter: string
  query: string
  selectedPath: string | null
  selectedChange: ChangeEntryView | null
}

/** Status tone class per wire letter; clsx accepts the undefined misses. */
function statusClass(status: ChangeStatus): string | undefined {
  switch (status) {
    case 'A': return css.stA
    case 'M': return css.stM
    case 'D': return css.stD
    case 'R': return css.stR
    /* v8 ignore next 2 -- closed-union backstop over the four wire letters */
    default: return undefined
  }
}

/** Status badge letter with its severity tone. */
function StatusBadge({ status }: { status: ChangeStatus }): React.ReactNode {
  return <span className={clsx(css.statusBadge, statusClass(status))}>{status}</span>
}

/** Read the persisted split preference (browser only). */
function initialSplit(): boolean {
  try {
    return window.localStorage.getItem(SPLIT_PREF_KEY) === '1'
  } catch {
    // Storage-denied environments simply do not persist the preference.
    return false
  }
}

/**
 * The whole explorer tab body. Loads roots once, adopts the first registry
 * root when nothing was picked yet, and mounts the requested pane.
 */
export function DifExplorerView(props: DifExplorerProps): React.ReactNode {
  const [viewer, setViewer] = useState<ViewerState>({
    roots: [],
    rootId: null,
    tree: null,
    tab: 'files',
    scope: 'worktree',
    statusFilter: '',
    toolFilter: '',
    pathFilter: '',
    query: '',
    selectedPath: null,
    selectedChange: null,
  })
  const [split, setSplit] = useState<boolean>(initialSplit)
  // Manual refresh bumps this; list panes remount through their composite keys.
  const [revision, setRevision] = useState(0)

  const patch = useCallback((next: Partial<ViewerState>) => {
    setViewer(previous => ({ ...previous, ...next }))
  }, [])

  // The explorer is bound to the open session's workspace: the root resolves
  // once from the session summary's cwd, with the registry order as fallback.
  const sessionSummary = props.useSessions(state => state.byId[props.sessionId])
  const cwd = sessionSummary?.cwd

  useEffect(() => {
    let alive = true
    props.api.listRoots()
      .then(({ roots }) => { if (alive) { patch({ roots }) } })
      .catch(() => {})
    return () => { alive = false }
  }, [patch, props.api])

  useEffect(() => {
    if (viewer.roots.length === 0 || viewer.rootId !== null) return
    const cwdRoot = cwd !== undefined
      ? viewer.roots.find(root => root.path === cwd)
      : undefined
    const chosen = cwdRoot ?? viewer.roots[0]
    if (chosen !== undefined) patch({ rootId: chosen.rootId })
  }, [cwd, patch, viewer.rootId, viewer.roots])

  useEffect(() => {
    const rootId = viewer.rootId
    if (rootId === null) return
    let alive = true
    props.api.listTree(rootId)
      .then((tree) => { if (alive) { patch({ tree }) } })
      .catch(() => {})
    return () => { alive = false }
  }, [patch, props.api, viewer.rootId, revision])

  useEffect(() => {
    try {
      window.localStorage.setItem(SPLIT_PREF_KEY, split ? '1' : '0')
    } catch {
      // Storage-denied environments skip persistence silently.
    }
  }, [split])

  const listPane = viewer.tab === 'files'
    ? (
      <FilesPane
        key={`f:${viewer.rootId ?? ''}:${revision}`}
        tree={viewer.tree}
        query={viewer.query}
        t={(key, params) => props.t(key, params)}
        onOpen={(selectedPath) => { patch({ selectedPath, selectedChange: null }) }}
      />
    )
    : (
      <ChangesPane
        key={`c:${viewer.rootId ?? ''}:${revision}`}
        api={props.api}
        t={(key, params) => props.t(key, params)}
        rootId={viewer.rootId}
        gitAvailable={viewer.tree !== null && viewer.tree.gitAvailable}
        scope={viewer.scope}
        statusFilter={viewer.statusFilter}
        toolFilter={viewer.toolFilter}
        pathFilter={viewer.pathFilter}
        onScope={(scope) => { patch({ scope }) }}
        onStatusFilter={(statusFilter) => { patch({ statusFilter }) }}
        onToolFilter={(toolFilter) => { patch({ toolFilter }) }}
        onPathFilter={(pathFilter) => { patch({ pathFilter }) }}
        onOpen={(selectedPath, selectedChange) => { patch({ selectedPath, selectedChange }) }}
      />
    )

  return (
    <div className={css.surface}>
      <div className={css.toolbar}>
        <div className={css.toolbarGroup}>
          <button
            type="button"
            className={css.toggle}
            aria-pressed={viewer.tab === 'files'}
            onClick={() => { patch({ tab: 'files' }) }}
          >
            <svg className={css.toggleIcon} viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M4 1.5h5.25L12.5 4.75V14.5H4z" />
              <path d="M9.25 1.5v3.25h3.25" />
            </svg>
            {props.t('tab.files')}
          </button>
          <button
            type="button"
            className={css.toggle}
            aria-pressed={viewer.tab === 'changes'}
            onClick={() => { patch({ tab: 'changes' }) }}
          >
            <svg className={css.toggleIcon} viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M4.75 2.25v5.5" />
              <path d="M2 5h5.5" />
              <path d="M11.25 8.25v5.5" />
              <path d="M8.5 11h5.5" />
            </svg>
            {props.t('tab.changes')}
          </button>
        </div>
        {viewer.tab === 'files' && (
          <div className={css.search}>
            <svg className={css.toggleIcon} viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="7" cy="7" r="4.6" />
              <path d="M10.4 10.4 14 14" />
            </svg>
            <input
              type="search"
              className={css.searchInput}
              value={viewer.query}
              placeholder={props.t('files.search')}
              onChange={(event) => { patch({ query: event.target.value }) }}
            />
          </div>
        )}
        <button
          type="button"
          className={clsx(css.toggle, css.iconOnly)}
          title="⟳"
          aria-label="⟳"
          onClick={() => { setRevision(value => value + 1) }}
        >
          <svg className={css.toggleIcon} viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M13.2 8a5.2 5.2 0 1 1-1.6-3.75" />
            <path d="M13.4 1.9v2.6h-2.6" />
          </svg>
        </button>
      </div>
      {viewer.selectedPath !== null && viewer.rootId !== null
        ? (
          <DiffViewer
            key={`v:${viewer.rootId}:${viewer.selectedPath}:${String(revision)}`}
            api={props.api}
            t={(key, params) => props.t(key, params)}
            rootId={viewer.rootId}
            path={viewer.selectedPath}
            change={viewer.selectedChange}
            split={split}
            onClose={() => { patch({ selectedPath: null, selectedChange: null }) }}
            onSetSplit={setSplit}
          />
        )
        : listPane}
    </div>
  )
}

/** Files tab: fuzzy-searchable collapsible tree with worktree status badges. */
function FilesPane({
  tree,
  query,
  t,
  onOpen,
}: {
  tree: TreeResponse | null
  query: string
  t: Translate
  onOpen: (path: string) => void
}): React.ReactNode {
  const statuses = useMemo(
    () => new Map((tree?.statuses ?? []).map(entry => [entry.path, entry.status] as const)),
    [tree],
  )
  const files = useMemo(() => filterTreePaths(tree?.files ?? [], query), [query, tree])
  const nodes = useMemo(() => buildTree(files), [files])
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const toggleDir = useCallback((dirPath: string) => {
    setCollapsed((previous) => {
      const next = new Set(previous)
      if (next.has(dirPath)) next.delete(dirPath)
      else next.add(dirPath)
      return next
    })
  }, [])

  if (tree !== null && !tree.gitAvailable) {
    return <div className={css.emptyNote}>{t('files.gitUnavailable')}</div>
  }

  const renderNode = (node: TreeNode, depth: number): React.ReactNode => {
    if (node.dir) {
      return (
        <div key={`d:${node.path}`}>
          <button
            type="button"
            className={css.treeRow}
            style={{ paddingLeft: 24 + depth * 16 }}
            onClick={() => { toggleDir(node.path) }}
          >
            <span className={css.dirChevron}>{collapsed.has(node.path) ? '▸' : '▾'}</span>
            <span className={css.dirName}>{node.name}/</span>
            <span className={css.dirCount}>{node.children?.length ?? 0}</span>
          </button>
          {!collapsed.has(node.path) && renderNodes(node.children, depth + 1)}
        </div>
      )
    }
    const status = statuses.get(node.path)
    return (
      <button
        key={`f:${node.path}`}
        type="button"
        className={clsx(css.treeRow, css.fileRow)}
        style={{ paddingLeft: 24 + depth * 16 + 12 }}
        onClick={() => { onOpen(node.path) }}
      >
        <span className={css.fileNameWithBadge}>
          <span className={css.fileName}>{node.name}</span>
          {status !== undefined && <StatusBadge status={status} />}
        </span>
      </button>
    )
  }

  function renderNodes(children: readonly TreeNode[] | undefined, depth: number): React.ReactNode {
    return children?.map(node => renderNode(node, depth))
  }

  return (
    <div className={css.filesPane}>
      <div className={css.paneScroll}>
        {nodes.length === 0
          ? <div className={css.emptyNote}>{t('files.empty')}</div>
          : renderNodes(nodes, 0)}
      </div>
    </div>
  )
}

function ChangeEntryRow({
  entry,
  t,
  onOpen,
}: {
  entry: ChangeEntryView
  t: Translate
  onOpen: (path: string, entry: ChangeEntryView) => void
}): React.ReactNode {
  const meta = [
    entry.tool ?? null,
    entry.sessionId !== undefined ? `${t('meta.session')} ${entry.sessionId.slice(0, 8)}` : null,
    entry.commitOid !== undefined ? `${t('meta.commit')} ${entry.commitOid.slice(0, 7)}` : null,
    entry.at !== undefined ? entry.at.replace('T', ' ').slice(0, 16) : null,
  ].filter(Boolean).join(' · ')
  return (
    <button type="button" className={css.changeRow} onClick={() => { onOpen(entry.path, entry) }}>
      <StatusBadge status={entry.status} />
      <span className={css.changePath}>
        {entry.oldPath === undefined ? entry.path : `${entry.oldPath} → ${entry.path}`}
      </span>
      {entry.hunksCount !== null && <span className={css.changeHunks}>{`±${entry.hunksCount}`}</span>}
      <span className={css.changeMeta}>{meta}</span>
    </button>
  )
}

/** Changes tab: scope switch, ledger filters, entry list. */
function ChangesPane({
  api,
  t,
  rootId,
  gitAvailable,
  scope,
  statusFilter,
  toolFilter,
  pathFilter,
  onScope,
  onStatusFilter,
  onToolFilter,
  onPathFilter,
  onOpen,
}: {
  api: DifExplorerInjected['api']
  t: Translate
  rootId: string | null
  gitAvailable: boolean
  scope: Scope
  statusFilter: string
  toolFilter: string
  pathFilter: string
  onScope: (scope: Scope) => void
  onStatusFilter: (value: string) => void
  onToolFilter: (value: string) => void
  onPathFilter: (value: string) => void
  onOpen: (path: string, entry: ChangeEntryView) => void
}): React.ReactNode {
  const [entries, setEntries] = useState<readonly ChangeEntryView[]>([])
  const [failed, setFailed] = useState(false)
  // Git-less scopes cannot serve; the session ledger still can.
  const blockedScope = scope !== 'session' && !gitAvailable

  useEffect(() => {
    if (rootId === null || blockedScope) return
    let alive = true
    setFailed(false)
    api.listChanges(rootId, scope)
      .then(({ entries: found }) => { if (alive) { setEntries(found) } })
      .catch(() => { if (alive) { setFailed(true) } })
    return () => { alive = false }
  }, [api, blockedScope, rootId, scope])

  const visible = entries.filter(entry =>
    (statusFilter === '' || entry.status === statusFilter)
    && (toolFilter === '' || entry.tool === toolFilter)
    && (pathFilter === '' || entry.path.includes(pathFilter)))

  const scopeLabel = (target: Scope): string =>
    target === 'worktree' ? t('changes.scope.worktree')
      : target === 'commit' ? t('changes.scope.commit') : t('changes.scope.session')

  const scopeIcon = (target: Scope): React.ReactNode => {
    if (target === 'worktree') {
      return (
        <svg className={css.toggleIcon} viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="4.5" cy="3.75" r="1.9" />
          <circle cx="4.5" cy="12.25" r="1.9" />
          <path d="M4.5 5.65v4.7" />
          <circle cx="11.5" cy="3.75" r="1.9" />
          <path d="M11.5 5.65c0 3.4-4.5 3.2-7 4.4" />
        </svg>
      )
    }
    if (target === 'session') {
      return (
        <svg className={css.toggleIcon} viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M2.5 3.5h11v7H6.25L3.5 13v-2.5H2.5z" />
        </svg>
      )
    }
    return (
      <svg className={css.toggleIcon} viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="3.4" />
        <path d="M8 1.5v3.1" />
        <path d="M8 11.4v3.1" />
      </svg>
    )
  }

  return (
    <div className={css.changesPane}>
      <div className={css.filterRow}>
        <div className={css.toolbarGroup}>
          {(['worktree', 'session', 'commit'] as const).map(target => (
            <button
              key={target}
              type="button"
              className={css.toggle}
              aria-pressed={target === scope}
              onClick={() => {
                // Re-clicking the active scope must not wipe the loaded ledger:
                // the fetch effect keys on scope and would not re-run.
                if (target === scope) return
                onScope(target)
                setEntries([])
              }}
            >
              {scopeIcon(target)}
              {scopeLabel(target)}
            </button>
          ))}
        </div>
        <select
          className={css.filterSelect}
          value={statusFilter}
          onChange={(event) => { onStatusFilter(event.target.value) }}
          aria-label={t('changes.filter.status')}
        >
          <option value="">{`${t('changes.filter.status')}: ${t('changes.filter.all')}`}</option>
          {(['A', 'M', 'D', 'R'] as const).map(letter => <option key={letter} value={letter}>{letter}</option>)}
        </select>
        <select
          className={css.filterSelect}
          value={toolFilter}
          onChange={(event) => { onToolFilter(event.target.value) }}
          aria-label={t('changes.filter.tool')}
        >
          <option value="">{`${t('changes.filter.tool')}: ${t('changes.filter.all')}`}</option>
          {[...new Set(entries.flatMap(entry => entry.tool === undefined ? [] : [entry.tool]))].sort()
            .map(tool => <option key={tool} value={tool}>{tool}</option>)}
        </select>
        <input
          className={css.pathInput}
          value={pathFilter}
          placeholder={t('changes.filter.path')}
          onChange={(event) => { onPathFilter(event.target.value) }}
        />
      </div>
      <div className={css.paneScroll}>
        {visible.length === 0
          ? <div className={css.emptyNote}>{blockedScope || failed ? t('state.error') : t('changes.empty')}</div>
          : visible.map((entry, index) => (
            <ChangeEntryRow
              key={`${entry.scope}:${entry.path}:${entry.seq ?? index}`}
              entry={entry}
              t={t}
              onOpen={onOpen}
            />
          ))}
      </div>
    </div>
  )
}

/**
 * The diff surface for one file: mode switch, meta strip, both render modes
 * fed from one hunk list. Hotkeys inside the panel: j/k hunk focus, n/N
 * next/previous change cluster, t mode toggle, Esc close.
 */
function DiffViewer({
  api,
  t,
  rootId,
  path,
  change,
  split,
  onClose,
  onSetSplit,
}: {
  api: DifExplorerInjected['api']
  t: Translate
  rootId: string
  path: string
  change: ChangeEntryView | null
  split: boolean
  onClose: () => void
  onSetSplit: (split: boolean) => void
}): React.ReactNode {
  const [diff, setDiff] = useState<DiffResponse | null>(null)
  const hunkFocus = useRef(0)

  useEffect(() => {
    let alive = true
    setDiff(null)
    // Commit rows diff that commit against its parent; worktree rows diff
    // HEAD against the working tree; session rows replay the logged fragment.
    const request = change !== null && change.scope === 'session'
      && change.seq !== undefined && change.sessionId !== undefined
      ? api.getDiff({ rootId, sessionId: change.sessionId, seq: change.seq })
      : change !== null && change.scope === 'commit' && change.commitOid !== undefined
        ? api.getDiff({ rootId, path, base: `${change.commitOid}^`, head: change.commitOid })
        : api.getDiff({ rootId, path })
    request.then((response) => { if (alive) { setDiff(response) } }).catch(() => {})
    return () => { alive = false }
  }, [api, change, path, rootId])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const total = diff?.hunks.length ?? 0
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      } else if (event.key === 't') {
        event.preventDefault()
        onSetSplit(!split)
      } else if (event.key === 'j' || event.key === 'n') {
        event.preventDefault()
        stepHunk(hunkFocus, total, 1)
      } else if (event.key === 'k' || event.key === 'N') {
        event.preventDefault()
        stepHunk(hunkFocus, total, -1)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown) }
  }, [diff, onClose, onSetSplit, split])

  return (
    <div className={css.viewer}>
      <div className={css.viewerHeader}>
        <Button variant="ghost" onClick={() => { onClose() }}>{t('diff.close')}</Button>
        <span className={css.viewerPath}>{path}</span>
        <span className={css.modeSwitch}>
          <button
            type="button"
            className={clsx(split && css.modeActive)}
            onClick={() => { onSetSplit(true) }}
          >{t('diff.split')}</button>
          <button
            type="button"
            className={clsx(!split && css.modeActive)}
            onClick={() => { onSetSplit(false) }}
          >{t('diff.unified')}</button>
        </span>
      </div>
      {change !== null && (
        <div className={css.metaLine}>
          {change.tool !== undefined && <Pill>{change.tool}</Pill>}
          {change.at !== undefined && (
            <span className={css.metaTime}>{change.at.replace('T', ' ').slice(0, 19).replace('Z', '')}</span>
          )}
          <span className={css.metaSizes}>
            <span className={css.additions}>{`+${diff?.additions ?? 0}`}</span>
            {' '}
            <span className={css.deletions}>{`−${diff?.deletions ?? 0}`}</span>
          </span>
        </div>
      )}
      <DiffBody diff={diff} split={split} t={t} />
    </div>
  )
}

/** Scroll the focused hunk header into view within clamp bounds. */
function stepHunk(cursor: { current: number }, total: number, delta: number): void {
  if (total === 0) return
  cursor.current = Math.min(Math.max(cursor.current + delta, 0), total - 1)
  document.querySelector(`[${DATA_HUNK_INDEX}="${cursor.current}"]`)
    ?.scrollIntoView({ block: 'start', behavior: 'smooth' })
}

/** Shared body renderer across modes with graceful-degradation states. */
function DiffBody({
  diff,
  split,
  t,
}: {
  diff: DiffResponse | null
  split: boolean
  t: Translate
}): React.ReactNode {
  if (diff === null) return <div className={css.stateNote}>{t('state.loading')}</div>
  if (diff.binary) {
    return <div className={css.stateNote}>{`${t('diff.binary')} · ${diff.newSize ?? diff.oldSize ?? 0} B`}</div>
  }
  if (diff.oversized) {
    return (
      <div className={css.stateNote}>
        <div>{t('diff.oversized')}</div>
        <div>{`+${diff.additions} −${diff.deletions}`}</div>
      </div>
    )
  }
  if (diff.identical) return <div className={css.stateNote}>{t('diff.identical')}</div>
  if (!split) {
    const rows = rowsUnified(diff.hunks.map(hunk => [...hunk.rows] as const))
    const shownRows = rows.slice(0, RENDER_CAP_ROWS)
    return (
      <div className={css.paneScroll}>
        {shownRows.map((row, index) => (
          <div
            key={index}
            {...(row.hunkIndex === undefined ? {} : { [DATA_HUNK_INDEX]: row.hunkIndex })}
            className={clsx(css.uRow, row.kind === 'del' ? css.u_del : row.kind === 'add' ? css.u_add : undefined)}
          >
            <span className={css.lineNo}>{row.oldNo ?? ''}</span>
            <span className={css.lineNo}>{row.newNo ?? ''}</span>
            <span className={css.uText}>{row.text}</span>
          </div>
        ))}
        {rows.length > shownRows.length && (
          <div className={css.moreNote}>{t('diff.truncatedMore', { count: rows.length - shownRows.length })}</div>
        )}
      </div>
    )
  }
  const pairs = rowsSplit(diff.hunks.map(hunk => [...hunk.rows] as const))
  const shownPairs = pairs.slice(0, Math.ceil(RENDER_CAP_ROWS / 2))
  return (
    <div className={css.paneScroll}>
      {shownPairs.map((pair, index) => <SplitPairRow key={index} pair={pair} />)}
      {pairs.length > shownPairs.length && (
        <div className={css.moreNote}>{t('diff.truncatedMore', { count: pairs.length - shownPairs.length })}</div>
      )}
    </div>
  )
}

/** One aligned side-by-side pair; changed pairs get word-level highlighting. */
function SplitPairRow({ pair }: { pair: ReturnType<typeof rowsSplit>[number] }): React.ReactNode {
  const parts = pair.kind === 'change'
    && pair.left !== undefined && pair.right !== undefined
    && pair.left.text !== pair.right.text
    ? intraLine(pair.left.text, pair.right.text)
    : null
  return (
    <div className={css.splitRow}>
      <div className={clsx(css.splitSide, pair.left?.kind === 'del' && css.sideDel)}>
        <span className={css.lineNo}>{pair.left?.oldNo ?? ''}</span>
        <span className={css.splitText}>
          {parts === null
            ? pair.left?.text ?? ''
            : parts.left.map((part, partIndex) => part.marked
              ? <mark key={partIndex} className={css.intraDel}>{part.text}</mark>
              : <span key={partIndex}>{part.text}</span>)}
        </span>
      </div>
      <div className={clsx(css.splitSide, pair.right?.kind === 'add' && css.sideAdd)}>
        <span className={css.lineNo}>{pair.right?.newNo ?? ''}</span>
        <span className={css.splitText}>
          {parts === null
            ? pair.right?.text ?? ''
            : parts.right.map((part, partIndex) => part.marked
              ? <mark key={partIndex} className={css.intraAdd}>{part.text}</mark>
              : <span key={partIndex}>{part.text}</span>)}
        </span>
      </div>
    </div>
  )
}
