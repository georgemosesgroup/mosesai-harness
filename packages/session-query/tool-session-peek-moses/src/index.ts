/**
 * session-peek — read-only model tools over `ctx.sessionQuery` exposing OTHER
 * sessions of this DSH install (cross-process, live-preferred logical corpus).
 *
 * Registered tools:
 * - `peek_session_list` — newest-first summary rows enriched with log-backed titles.
 * - `peek_session_read` — bounded raw-log window of one session (limit + offset-from-end).
 * - `peek_session_search` — full-text search across the install, or within one session.
 *
 * Every tool is strictly read-only: the only capability touched is
 * `ctx.sessionQuery`, which never mutates session state. Failures (unknown id,
 * disabled search provider, malformed filters) propagate as thrown errors and
 * surface to the model as ordinary isError tool results.
 *
 * @module @deepseek-ai/dsh-tool-session-peek-moses
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  SessionQueryError,
  SessionSearchCursor,
  extractSessionEventText,
} from '@deepseek-ai/dsh-session-query'
import type { SessionQueryEngine } from '@deepseek-ai/dsh-session-query'
import type { SessionTitleObservationResult } from '@deepseek-ai/dsh-session-query'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'tool-session-peek-moses'

/** Capability services required by the tools and the usage-guidance section. */
export const inject = ['tools', 'sessionQuery', 'systemPrompt']

/** Node timers refuse delays above 2^31-1 ms (they fire immediately instead). */
const MAX_TIMEOUT_MS = 2_147_483_647

/** Deployment-owned paging, truncation, and deadline bounds. */
export interface Config {
  /** Page size used when a call omits `limit`. Defaults to 20. */
  defaultLimit?: number
  /** Hard ceiling for any requested page size. Defaults to 100. */
  maxLimit?: number
  /** Per-event semantic-text cap inside `peek_session_read` output. Defaults to 4000. */
  eventTextMaxChars?: number
  /** Model-facing character budget enforced by every renderer. Defaults to 24000. */
  maxOutputChars?: number
  /** Cooperative deadline for full-text search calls, milliseconds. Defaults to 30000. */
  searchTimeoutMs?: number
  /** Retries for transient search-index stabilization on a busy install. Defaults to 2. */
  searchStabilizationRetries?: number
}

/** Schemastery config for Loader validation and defaults. */
export const Config: z<Config> = z.object({
  defaultLimit: z.number().step(1).min(1).max(500).default(20),
  maxLimit: z.number().step(1).min(1).max(500).default(100),
  eventTextMaxChars: z.number().step(1).min(200).max(200_000).default(4000),
  maxOutputChars: z.number().step(1).min(2000).max(2_000_000).default(24_000),
  searchTimeoutMs: z.number().step(1).min(1).max(MAX_TIMEOUT_MS).default(30_000),
  searchStabilizationRetries: z.number().step(1).min(0).max(5).default(2),
})

interface ResolvedConfig {
  readonly defaultLimit: number
  readonly maxLimit: number
  readonly eventTextMaxChars: number
  readonly maxOutputChars: number
  readonly searchTimeoutMs: number
  readonly searchStabilizationRetries: number
}

/**
 * Apply documented defaults and validate every bound loudly so bad values fail
 * at load instead of degrading tool behavior.
 * @param config - raw Loader-interpolated config.
 * @returns fully-resolved paging, truncation, and deadline bounds.
 * @throws `TypeError` when a value is out of range or not a safe integer.
 */
export function resolveConfig(config: Config): ResolvedConfig {
  const resolved = {
    defaultLimit: config.defaultLimit ?? 20,
    maxLimit: config.maxLimit ?? 100,
    eventTextMaxChars: config.eventTextMaxChars ?? 4000,
    maxOutputChars: config.maxOutputChars ?? 24_000,
    searchTimeoutMs: config.searchTimeoutMs ?? 30_000,
    searchStabilizationRetries: config.searchStabilizationRetries ?? 2,
  }
  for (const [key, value] of Object.entries(resolved)) {
    if (!Number.isSafeInteger(value) || value < (key === 'searchStabilizationRetries' ? 0 : 1)) {
      throw new TypeError(`tool-session-peek-moses: ${key} must be a safe integer ≥ ${key === 'searchStabilizationRetries' ? 0 : 1}`)
    }
    if (key === 'searchTimeoutMs' && value > MAX_TIMEOUT_MS) {
      throw new TypeError(`tool-session-peek-moses: searchTimeoutMs must not exceed ${MAX_TIMEOUT_MS}`)
    }
  }
  if (resolved.defaultLimit > resolved.maxLimit) {
    throw new TypeError('session-peek: defaultLimit must not exceed maxLimit')
  }
  return resolved
}

/** Clamp one requested count into `[1, maxLimit]`, rejecting non-integers. */
function clampCount(value: number, maxLimit: number): number {
  if (!Number.isSafeInteger(value)) {
    throw new SessionQueryError('limit must be an integer', 'SESSION_QUERY_INVALID_LIMIT')
  }
  return Math.min(Math.max(value, 1), maxLimit)
}

/** Reject negative or non-integer offsets. */
function clampOffset(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new SessionQueryError('offset must be a non-negative safe integer', 'SESSION_QUERY_INVALID_FILTER')
  }
  return value
}

/** Reject ids the schema DSL cannot express constraints for (empty strings). */
function assertNonEmptySessionId(value: string): void {
  if (value.trim().length === 0) {
    throw new SessionQueryError('sessionId must be a non-empty string', 'SESSION_QUERY_INVALID_FILTER')
  }
}

/** Normalize one search query the way the search contract expects. */
function normalizeQuery(value: string): string {
  const query = value.trim().replace(/\s+/gu, ' ')
  if (query.length === 0) {
    throw new SessionQueryError(
      'query must contain non-whitespace text',
      'SESSION_QUERY_INVALID_QUERY',
    )
  }
  if (query.includes('\0')) {
    throw new SessionQueryError('query must not contain NUL', 'SESSION_QUERY_INVALID_QUERY')
  }
  return query
}

/** Backoff base for transient search-index stabilization retries. */
const STABILIZATION_BACKOFF_BASE_MS = 400

/** Abortable delay; rejects with an abort error when the signal fires. */
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new SessionQueryError('session-search aborted', 'SESSION_QUERY_ABORTED'))
    }, { once: true })
  })
}

/**
 * Retry one search request across the provider's transient stabilization
 * window: while sibling processes append to persistence, a cold index
 * reconciliation can fail its stability check shortly before it would settle.
 * Only SESSION_QUERY_PERSISTENCE_FAILED is transient here; every other
 * failure (bad query, unknown id, disabled provider) rethrows immediately.
 */
async function stableSearch<T>(signal: AbortSignal, retries: number, run: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await run()
    } catch (error) {
      const transient = error instanceof SessionQueryError
        && error.code === 'SESSION_QUERY_PERSISTENCE_FAILED'
      if (!transient || attempt >= retries) throw error
      await delay(Math.min(STABILIZATION_BACKOFF_BASE_MS * 2 ** attempt, 5000), signal)
    }
  }
}

/** Fold one batch title observation into a plain sessionId → title map. */
function foldTitles(results: readonly SessionTitleObservationResult[]): Map<string, string> {
  const titles = new Map<string, string>()
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value.title !== undefined) {
      titles.set(result.sessionId, result.value.title.title)
    }
  }
  return titles
}

/** Middle-truncate one rendered text to the budget, keeping head and tail. */
function truncateMiddle(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const marker = `\n…[truncated ${text.length - maxChars} chars to fit the tool budget; narrow with limit/offset]…\n`
  const keep = Math.max(0, maxChars - marker.length)
  const headKeep = Math.floor(keep / 2)
  const tailKeep = keep - headKeep
  return text.slice(0, headKeep) + marker + (tailKeep > 0 ? text.slice(text.length - tailKeep) : '')
}

/** Render one bounded event summary line pair for `peek_session_read`. */
function summarizeEvent(event: SessionEvent, eventTextMaxChars: number): {
  seq: number
  time: number
  type: string
  text: string
} {
  const raw = extractSessionEventText(event)
  return {
    seq: event.seq,
    time: event.time,
    type: event.type,
    text: raw === '' ? '' : truncateMiddle(raw, eventTextMaxChars),
  }
}

const LIST_PARAMETERS = {
  limit: { type: 'integer', description: 'Maximum sessions to return, newest first. Defaults to 20.' },
} as const

interface SessionListEntry {
  sessionId: string
  title?: string
  live: boolean
  persisted: boolean
  createdAt: number
}

interface SessionListResult {
  totalKnown: number
  returned: number
  sessions: SessionListEntry[]
}

const LIST_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    totalKnown: { type: 'integer', description: 'Sessions visible in the whole install.' },
    returned: { type: 'integer', description: 'Rows actually included.' },
    sessions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sessionId: { type: 'string' },
          title: { type: 'string' },
          live: { type: 'boolean', description: 'Currently open in some process of this install.' },
          persisted: { type: 'boolean', description: 'Materialized by the persistence backend.' },
          createdAt: { type: 'integer', description: 'Unix epoch milliseconds.' },
        },
      },
    },
  },
} as const

const READ_PARAMETERS = {
  sessionId: { type: 'string', required: true, description: 'Target session id from peek_session_list or peek_session_search.' },
  limit: { type: 'integer', description: 'Maximum events returned counting back from the end. Defaults to 20.' },
  offset: { type: 'integer', description: 'How many NEWEST events to skip first (page backwards).' },
} as const

interface SessionReadResult {
  session: {
    sessionId: string
    createdAt: number
    cwd?: string
    parentSession?: string
  }
  totalEvents: number
  window: {
    firstSeq?: number
    lastSeq?: number
    olderAvailable: number
    skippedNewest: number
  }
  events: Array<{
    seq: number
    time: number
    type: string
    text: string
  }>
}

const READ_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    session: {
      type: 'object',
      additionalProperties: false,
      properties: {
        sessionId: { type: 'string', required: true },
        createdAt: { type: 'integer', required: true },
        cwd: { type: 'string' },
        parentSession: { type: 'string' },
      },
    },
    totalEvents: { type: 'integer', required: true },
    window: {
      type: 'object',
      additionalProperties: false,
      properties: {
        firstSeq: { type: 'integer' },
        lastSeq: { type: 'integer' },
        olderAvailable: { type: 'integer', required: true, description: 'Events older than this window.' },
        skippedNewest: { type: 'integer', required: true, description: 'Newest events hidden by offset.' },
      },
    },
    events: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          seq: { type: 'integer', required: true },
          time: { type: 'integer', required: true },
          type: { type: 'string', required: true },
          text: { type: 'string', required: true, description: 'Semantic text, truncated per event. Empty for structural events.' },
        },
      },
    },
  },
} as const

const SEARCH_PARAMETERS = {
  query: { type: 'string', required: true, description: 'Literal case-insensitive full-text query.' },
  sessionId: { type: 'string', description: 'Search inside this one session instead of across the install.' },
  limit: { type: 'integer', description: 'Maximum hits on this page. Defaults to 20.' },
  cursor: { type: 'string', description: 'Opaque nextCursor echoed by a previous page.' },
} as const

interface SearchItem {
  sessionId: string
  title?: string
  live?: boolean
  persisted?: boolean
  seq: number
  time: number
  type: string
  snippet: string
}

interface SessionSearchResult {
  scope: 'sessions' | 'events'
  query: string
  sessionId?: string
  nextCursor?: string
  items: SearchItem[]
}

const SEARCH_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    scope: { type: 'string', enum: ['sessions', 'events'], required: true },
    query: { type: 'string', required: true },
    sessionId: { type: 'string', description: 'Present when scope is events.' },
    nextCursor: { type: 'string', description: 'Pass back as cursor for the next page; absent on the last page.' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sessionId: { type: 'string', required: true },
          title: { type: 'string', description: 'Present when scope is sessions.' },
          live: { type: 'boolean' },
          persisted: { type: 'boolean' },
          seq: { type: 'integer', required: true, description: 'Strongest matching event.' },
          time: { type: 'integer', required: true },
          type: { type: 'string', required: true },
          snippet: { type: 'string', required: true },
        },
      },
    },
  },
} as const

/** Model-facing guidance teaching agents WHEN to reach for the peek tools. */
const USAGE_SECTION_TEXT =
  'Cross-session visibility: several parallel sessions of this DSH install may work over shared '
  + 'repositories at the same time. You have read-only tools to see them:\n'
  + '- peek_session_list — who exists right now (titles, live/persisted availability);\n'
  + '- peek_session_read — a bounded window into another session\'s event log;\n'
  + '- peek_session_search — full-text search across sessions or inside one session.\n'
  + 'Use them proactively: check the live list before editing files another session may be '
  + 'touching; when files or git history changed unexpectedly, read or search the sibling '
  + 'session\'s log instead of guessing; when the user refers to another session or agent, look '
  + 'it up here first. Keep read windows bounded (limit/offset); session ids are opaque and must '
  + 'be used exactly as returned.'

/** The slice of `ctx.sessionQuery` the peek tools read through. */
export type SessionQueryPick = Pick<
  SessionQueryEngine,
  'listSessions' | 'readTitleSnapshots' | 'readSession' | 'searchSessions' | 'searchEvents'
>

/**
 * Register the three read-only session-peek tools plus their usage-guidance
 * prompt section.
 * @param ctx - the mounting Cordis context.
 * @param config - validated deployment bounds (Loader interpolates defaults).
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config)

  ctx.systemPrompt.section({
    name: 'session-peek:usage',
    order: 114,
    text: USAGE_SECTION_TEXT,
  })

  for (const tool of createPeekTools(ctx.sessionQuery, resolved)) {
    ctx.tools.register(tool)
  }
}

/**
 * Build the three tool definitions against an explicit session-query handle.
 * Split from {@link apply} so tests drive the exact registered bodies with a
 * scripted seam instead of a live corpus.
 *
 * @param sessionQuery - the session-query reads the tools project through.
 * @param resolved - validated deployment bounds.
 * @returns the three registry-ready definitions, in registration order.
 */
export function createPeekTools(
  sessionQuery: SessionQueryPick,
  resolved: ResolvedConfig,
): ToolDefinition[] {
  const tools: ToolDefinition[] = []
  tools.push(defineTool({
    name: 'peek_session_list',
    description:
      'List other sessions recorded by this DSH install, newest first, with their titles and '
      + 'live/persisted availability. Read-only overview; follow up with peek_session_read or peek_session_search.',
    parameters: LIST_PARAMETERS,
    output: {
      schema: LIST_OUTPUT_SCHEMA,
      render: (_args, value: SessionListResult) => [{
        type: 'text',
        text: truncateMiddle([
          `${value.returned} of ${value.totalKnown} known sessions, newest first:`,
          ...value.sessions.map(session => [
            `- ${session.sessionId}`,
            new Date(session.createdAt).toISOString(),
            session.live ? 'live' : 'not-live',
            session.persisted ? 'persisted' : 'not-persisted',
            session.title === undefined ? '(no title)' : `"${session.title}"`,
          ].join(' | ')),
        ].join('\n'), resolved.maxOutputChars),
      }],
    },
    isConcurrencySafe: () => true,
    presentCall: args => ({ card: 'generic', kind: 'read', title: 'peek_session_list', rawInput: args }),
    async execute(args, exec): Promise<SessionListResult> {
      const limit = clampCount(args.limit ?? resolved.defaultLimit, resolved.maxLimit)
      const records = await sessionQuery.listSessions(exec.signal)
      exec.signal.throwIfAborted()
      const page = records.slice(0, limit)
      const titles = foldTitles(await sessionQuery.readTitleSnapshots(
        page.map(record => record.header.id),
        exec.signal,
      ))
      return {
        totalKnown: records.length,
        returned: page.length,
        sessions: page.map((record): SessionListEntry => {
          const title = titles.get(record.header.id)
          return {
            sessionId: record.header.id,
            ...(title === undefined ? {} : { title }),
            live: record.live,
            persisted: record.persisted,
            createdAt: record.header.createdAt,
          }
        }),
      }
    },
  }))

  tools.push(defineTool({
    name: 'peek_session_read',
    description:
      'Read a bounded window of another session\'s event log in this DSH install. Returns the '
      + 'newest events first by default; use offset to page further back. Long text is truncated.',
    parameters: READ_PARAMETERS,
    output: {
      schema: READ_OUTPUT_SCHEMA,
      render: (_args, value: SessionReadResult) => [{
        type: 'text',
        text: truncateMiddle([
          `Session ${value.session.sessionId}: ${value.totalEvents} events total`,
          `window seq ${value.window.firstSeq ?? '—'}..${value.window.lastSeq ?? '—'}`
            + ` (older available: ${value.window.olderAvailable}, newest hidden: ${value.window.skippedNewest})`,
          ...value.events.flatMap(event => [
            `#${event.seq} ${event.type} ${new Date(event.time).toISOString()}`,
            event.text === '' ? '  (structural event, no semantic text)' : `  ${event.text.replace(/\n/gu, '\n  ')}`,
          ]),
        ].join('\n'), resolved.maxOutputChars),
      }],
    },
    isConcurrencySafe: () => true,
    presentCall: args => ({ card: 'generic', kind: 'read', title: 'peek_session_read', rawInput: args }),
    async execute(args, exec): Promise<SessionReadResult> {
      assertNonEmptySessionId(args.sessionId)
      const snapshot = await sessionQuery.readSession(SessionId(args.sessionId))
      exec.signal.throwIfAborted()
      const offset = clampOffset(args.offset ?? 0)
      const limit = clampCount(args.limit ?? resolved.defaultLimit, resolved.maxLimit)
      const end = Math.max(0, snapshot.events.length - offset)
      const start = Math.max(0, end - limit)
      const window = snapshot.events.slice(start, end)
      const { cwd, parentSession } = snapshot.session
      return {
        session: {
          sessionId: snapshot.session.id,
          createdAt: snapshot.session.createdAt,
          ...(cwd === undefined ? {} : { cwd }),
          ...(parentSession === undefined ? {} : { parentSession }),
        },
        totalEvents: snapshot.events.length,
        window: {
          ...((window.length > 0
            ? {
              firstSeq: window.at(0)?.seq,
              lastSeq: window.at(-1)?.seq,
            }
            : {}) as { firstSeq?: number; lastSeq?: number }),
          olderAvailable: start,
          skippedNewest: Math.min(offset, snapshot.events.length),
        },
        events: window.map(event => summarizeEvent(event, resolved.eventTextMaxChars)),
      }
    },
  }))

  tools.push(defineTool({
    name: 'peek_session_search',
    description:
      'Full-text search over other sessions of this DSH install. Without sessionId, returns the '
      + 'strongest matching session per hit across the whole install; with sessionId, searches '
      + 'inside that one session and returns matching events. Read-only; paginate via nextCursor.',
    parameters: SEARCH_PARAMETERS,
    output: {
      schema: SEARCH_OUTPUT_SCHEMA,
      render: (_args, value: SessionSearchResult) => [{
        type: 'text',
        text: truncateMiddle([
          `Search "${value.query}" (${value.scope} scope): ${value.items.length} hits`,
          ...value.items.map(item => [
            `- ${item.sessionId} #${item.seq} ${item.type} ${new Date(item.time).toISOString()}`
              + (item.title === undefined ? '' : ` | "${item.title}"`)
              + (item.live === undefined ? '' : item.live ? ' | live' : ' | not-live'),
            `  ${item.snippet.replace(/\n/gu, ' ')}`,
          ]).flat(),
          value.nextCursor === undefined
            ? '(last page)'
            : `(more pages; repeat the identical request passing cursor=${value.nextCursor})`,
        ].join('\n'), resolved.maxOutputChars),
      }],
    },
    timeoutMs: resolved.searchTimeoutMs,
    isConcurrencySafe: () => true,
    presentCall: args => ({ card: 'generic', kind: 'search', title: 'peek_session_search', rawInput: args }),
    async execute(args, exec): Promise<SessionSearchResult> {
      const query = normalizeQuery(args.query)
      const limit = clampCount(args.limit ?? resolved.defaultLimit, resolved.maxLimit)
      if (args.sessionId !== undefined) {
        assertNonEmptySessionId(args.sessionId)
        const target = SessionId(args.sessionId)
        const page = await stableSearch(exec.signal, resolved.searchStabilizationRetries, () =>
          sessionQuery.searchEvents({
            sessionId: target,
            query,
            limit,
            ...(args.cursor === undefined ? {} : { cursor: SessionSearchCursor(args.cursor) }),
          }, { signal: exec.signal }))
        exec.signal.throwIfAborted()
        return {
          scope: 'events',
          query,
          sessionId: page.session.id,
          ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
          items: page.items.map(hit => ({
            sessionId: hit.sessionId,
            seq: hit.seq,
            time: hit.time,
            type: hit.type,
            snippet: hit.snippet,
          })),
        }
      }
      const page = await stableSearch(exec.signal, resolved.searchStabilizationRetries, () =>
        sessionQuery.searchSessions({
          query,
          limit,
          ...(args.cursor === undefined ? {} : { cursor: SessionSearchCursor(args.cursor) }),
        }, { signal: exec.signal }))
      exec.signal.throwIfAborted()
      const titles = foldTitles(await sessionQuery.readTitleSnapshots(
        page.items.map(hit => hit.header.id),
        exec.signal,
      ))
      return {
        scope: 'sessions',
        query,
        ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
        items: page.items.map((hit): SearchItem => {
          const t = titles.get(hit.header.id)
          return {
            sessionId: hit.header.id,
            ...(t === undefined ? {} : { title: t }),
            live: hit.live,
            persisted: hit.persisted,
            seq: hit.bestMatch.seq,
            time: hit.bestMatch.time,
            type: hit.bestMatch.type,
            snippet: hit.bestMatch.snippet,
          }
        }),
      }
    },

  }))

  return tools
}
