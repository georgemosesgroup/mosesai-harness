/**
 * Session-scope ledger: fold persisted tool-call events of mutating tools into
 * change entries with their textual before/after fragments. Pure over its
 * inputs so the fold stays unit-testable without a persistence backend.
 * @module @deepseek-ai/dsh-dif-explorer/sessionfold
 */

import { countChangedRows } from './difflib.ts'
import type { ChangeEntryView } from './types.ts'
import { confinedRelativePath } from './paths.ts'

/**
 * Tools whose arguments carry enough text to reconstruct a fragment diff.
 * Wire names are logged verbatim by the tools registry; comparisons are
 * case-insensitive because hook bridges may feed differently-cased names.
 */
const MUTATING_TOOLS: ReadonlyMap<string, string> = new Map([
  ['write', 'Write'],
  ['edit', 'Edit'],
  ['multiedit', 'MultiEdit'],
  ['str_replace_editor', 'str_replace_editor'],
])

/** Arguments the mutation tools carry on the wire, decoded per tool. */
interface MutatingToolArgs {
  readonly file_path?: unknown
  readonly content?: unknown
  readonly old_string?: unknown
  readonly new_string?: unknown
  readonly old_str?: unknown
  readonly new_str?: unknown
  readonly command?: unknown
}

/** Minimal view of one session log event the fold reads. Loose on purpose:
 * callers hand raw persisted events whose `data` unions this module must not
 * depend on beyond the tool-call payload it narrows itself. */
export interface FoldableEvent {
  readonly type: string
  readonly seq: number | undefined
  readonly time?: number | undefined
  readonly data?: unknown
}

/** A stored session's identity the entries echo back. */
export interface FoldingSession {
  readonly id: string
}

/** Raw tool-call event arguments after safe JSON decoding. */
interface DecodedCall {
  readonly seq: number
  readonly timeMs: number
  readonly toolRaw: string
  readonly args: MutatingToolArgs
}

/**
 * Decode every folding-relevant `tool/call` event of one event list.
 * Malformed argument JSON or unknown shapes skip the event silently — a log
 * is replayed as faithfully as it can be, never rejected wholesale.
 * @param events - a session's ordered log events.
 * @returns decoded calls in log order.
 */
export function decodeMutatingCalls(events: readonly FoldableEvent[]): readonly DecodedCall[] {
  const calls: DecodedCall[] = []
  for (const event of events) {
    if (event.type !== 'tool/call') continue
    const data = (typeof event.data === 'object' && event.data !== null ? event.data : {}) as {
      name?: unknown
      arguments?: unknown
    }
    const name = typeof data.name === 'string' ? data.name.toLowerCase() : ''
    if (!MUTATING_TOOLS.has(name)) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(typeof data.arguments === 'string' ? data.arguments : '{}')
    } catch {
      continue
    }
    if (typeof parsed !== 'object' || parsed === null) continue
    calls.push({
      seq: typeof event.seq === 'number' ? event.seq : -1,
      timeMs: typeof event.time === 'number' ? event.time : 0,
      toolRaw: MUTATING_TOOLS.get(name) ?? name,
      args: parsed,
    })
  }
  return calls
}

/**
 * Whether the call mutates the file it names and yields usable text sides.
 * @param call - a decoded tool/call record.
 * @param rootPath - workspace root for confinement.
 * @returns relative file path plus before/after fragments when the shape is usable.
 */
export function extractFragment(
  call: DecodedCall,
  rootPath: string,
): { readonly path: string; readonly before: string | null; readonly after: string | null } | undefined {
  const filePath = call.args.file_path
  if (typeof filePath !== 'string' || filePath.length === 0) return undefined
  let rel: string
  try {
    rel = confinedRelativePath(rootPath, filePath)
  } catch {
    // Path leaves this workspace: out of scope for this root's ledger.
    return undefined
  }
  const lower = call.toolRaw.toLowerCase()
  if (lower === 'write') {
    const content = call.args.content
    return typeof content === 'string'
      ? { path: rel, before: null, after: content }
      : undefined
  }
  if (lower === 'edit' || lower === 'multiedit') {
    const before = call.args.old_string
    const after = call.args.new_string
    return typeof before === 'string' && typeof after === 'string'
      ? { path: rel, before, after }
      : undefined
  }
  if (lower === 'str_replace_editor') {
    const command = typeof call.args.command === 'string' ? call.args.command : ''
    if (command === 'create') {
      const content = call.args.new_str ?? call.args.content
      return typeof content === 'string'
        ? { path: rel, before: null, after: content }
        : undefined
    }
    if (command === 'str_replace' || command === 'insert') {
      const before = typeof call.args.old_str === 'string' ? call.args.old_str : ''
      const after = typeof call.args.new_str === 'string' ? call.args.new_str : ''
      return { path: rel, before, after }
    }
    // view/read commands mutate nothing.
    return undefined
  }
  return undefined
}

const utf8ByteLength = (text: string): number => Buffer.byteLength(text, 'utf8')

/**
 * Fold one session's mutating calls into ledger entries.
 * Status is derived from the event alone: fragment-based records always show
 * `M` unless the event itself proves creation (`write`/`create` with no prior
 * side), where `beforeBytes` stays null rather than asserting absence that
 * the log cannot prove. Order follows log order.
 * @param session - owning session id echoed back onto the entries.
 * @param rootPath - canonical workspace root for path confinement.
 * @param events - the session's full ordered event list.
 * @returns one entry per usable mutating call.
 */
export function foldSessionChanges(
  session: FoldingSession,
  rootPath: string,
  events: readonly FoldableEvent[],
): readonly ChangeEntryView[] {
  const entries: ChangeEntryView[] = []
  for (const call of decodeMutatingCalls(events)) {
    const fragment = extractFragment(call, rootPath)
    if (fragment === undefined) continue
    const created = fragment.before === null
    const afterText = fragment.after ?? ''
    const beforeText = fragment.before ?? ''
    entries.push({
      path: fragment.path,
      status: created ? 'A' : 'M',
      scope: 'session',
      sessionId: session.id,
      tool: call.toolRaw,
      ...(call.seq >= 0 ? { seq: call.seq } : {}),
      at: new Date(call.timeMs).toISOString(),
      beforeBytes: fragment.before === null ? null : utf8ByteLength(fragment.before),
      afterBytes: utf8ByteLength(afterText),
      hunksCount: countChangedRows(beforeText, afterText),
    })
  }
  return entries
}
