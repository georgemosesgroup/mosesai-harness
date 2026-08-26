/**
 * Framework-free core of session-coordination: glob matching for claim
 * patterns, best-effort pattern-overlap detection, and the claim store with
 * TTL sweep, per-session ownership, and conflict rejection.
 *
 * Nothing here imports Cordis or the tools registry, so the unit test script
 * exercises exactly the logic the live plugin mounts.
 *
 * Supported pattern subset (documented in the tool descriptions too):
 * `/`-separated segments; `**` matches zero or more whole segments;
 * `*` matches any characters within one segment; `?` matches one character
 * within a segment. Braces, character classes, and extglobs are NOT supported
 * and match literally.
 *
 * @module @deepseek-ai/dsh-session-coordination-moses/claims-core
 */

/** One live path lease held by one session. */
export interface WorkspaceClaim {
  /** Owner session id (opaque; `exec.agent.session.id` of the acquirer). */
  sessionId: string
  /** Glob patterns this claim covers, as supplied by the owner. */
  patterns: string[]
  /** Unix epoch milliseconds when the lease lapses. */
  expiresAt: number
  /** Unix epoch milliseconds when the lease was taken. */
  acquiredAt: number
  /** Free-text reason shown to other sessions in deny messages. */
  note?: string
}

/** Deterministic clock seam so tests can drive expiry without waiting. */
export type Clock = () => number

/** Error thrown when another session's LIVE claim already covers a requested pattern. */
export class ClaimConflictError extends Error {
  /** The blocking claim, detached from the store. */
  readonly claim: Readonly<WorkspaceClaim>
  /** The requested pattern that collided. */
  readonly pattern: string

  constructor(pattern: string, claim: Readonly<WorkspaceClaim>) {
    super(conflictMessage(pattern, claim))
    this.name = 'ClaimConflictError'
    this.pattern = pattern
    this.claim = { ...claim }
  }
}

/**
 * The user-facing conflict sentence, shared by acquire errors and deny decisions.
 * @param pattern - requested path pattern that collided with a live claim.
 * @param claim - blocking claim whose owner and expiry are reported.
 * @returns one sentence naming the pattern, owner session, expiry, and note.
 */
export function conflictMessage(pattern: string, claim: Readonly<WorkspaceClaim>): string {
  const noteSuffix = claim.note === undefined ? '' : `: ${claim.note}`
  return `path pattern "${pattern}" is claimed by session ${claim.sessionId} until `
    + `${new Date(claim.expiresAt).toISOString()}${noteSuffix}`
}

/** Escape one literal segment for RegExp, then translate `*` and `?` wildcards. */
function segmentToRegExp(segment: string): string {
  return segment
    .replace(/[|\\{}()[\]^$+./]/gu, '\\$&')
    .replace(/\*/gu, '[^/]*')
    .replace(/\?/gu, '[^/]')
}

/**
 * Compile one supported-subset glob into an anchored RegExp over `/`-separated
 * paths. A `**` segment matches zero or more whole segments and carries its
 * own separators, so `a` + `/`+`**`+`/`+ `b` matches both `a/b` and
 * `a/x/y/b`, while `x/**` covers everything below `x/` but not `x` itself.
 * @param pattern - supported-subset glob over `/`-separated paths.
 * @returns anchored matcher to test against exact path strings.
 */
export function globToRegExp(pattern: string): RegExp {
  return new RegExp(`^${segmentsToRegExpSource(pattern.split('/'))}$`, 'u')
}

/** Recursive segment-list compiler; emits no leading or trailing separator. */
function segmentsToRegExpSource(segments: readonly string[]): string {
  if (segments.length === 0) return ''
  const [head, ...tail] = segments
  if (head === '**') {
    // Zero or more whole segments; repetitions carry their own `/`, so the
    // remainder attaches without an extra separator.
    const repetition = tail.length === 0
      ? '[^/]+(?:/[^/]+)*'
      : '(?:[^/]+/)*'
    return repetition + segmentsToRegExpSource(tail)
  }
  if (head === undefined) return ''
  const source = segmentToRegExp(head)
  return tail.length === 0 ? source : source + '/' + segmentsToRegExpSource(tail)
}

/**
 * Whether one concrete path matches one supported-subset pattern.
 * @param pattern - supported-subset glob to test.
 * @param path - concrete `/`-separated path.
 * @returns true when the anchored matcher accepts the path.
 */
export function globMatch(pattern: string, path: string): boolean {
  return globToRegExp(pattern).test(path)
}

/**
 * Generate bounded concrete witness paths for one pattern by expanding each
 * segment to a small representative set (`**` → none / one / two segments).
 * Overlap detection is then symmetric witness testing with the real matcher:
 * precise enough for early feedback, never authoritative — the per-path
 * `check()` at write time is the only arbitration that matters.
 *
 * @param pattern - pattern to expand into representative concrete paths.
 * @param limit - upper bound on returned witnesses.
 * @returns at most `limit` distinct concrete paths plausibly covered by `pattern`.
 */
export function witnessesOf(pattern: string, limit = 32): string[] {
  const segments = pattern.split('/')
  let partials: string[][] = [[]]
  for (const segment of segments) {
    // Wrap the rewritten segment in an array: `option` is spread below, and
    // spreading a bare string would explode it into per-character segments.
    const options = segment === '**'
      ? [[], ['w'], ['w', 'v']]
      : [[segment.replace(/\*/gu, 'a').replace(/\?/gu, 'x')]]
    const next: string[][] = []
    for (const prefix of partials) {
      for (const option of options) next.push([...prefix, ...option])
    }
    partials = next.slice(0, limit)
    if (partials.length >= limit) break
  }
  const seen = new Set<string>()
  for (const parts of partials) {
    const joined = parts.filter(part => part !== '').join('/')
    if (joined !== '') seen.add(joined)
  }
  seen.add(segments.filter(s => s !== '**').join('/'))
  return [...seen].slice(0, limit)
}

/**
 * Best-effort structural overlap: true when some concrete path plausibly
 * matches both patterns. May miss exotic wildcard interactions (documented);
 * it gates EARLY acquire UX, not correctness of enforcement.
 *
 * Both patterns are compared after trimming leading/trailing slashes so
 * absolute and relative spellings of the same scope recognize each other —
 * witnesses are generated slash-structure-preserving per side, and anchored
 * matchers would otherwise never cross the `/foo` vs `foo` spelling gap.
 *
 * @param left - first pattern, any absolute/relative spelling.
 * @param right - second pattern, any absolute/relative spelling.
 * @returns true when some witness path matches both sides.
 */
export function patternsOverlap(left: string, right: string): boolean {
  const normalize = (pattern: string): string => pattern.replace(/^\/+|\/+$/gu, '')
  const l = normalize(left)
  const r = normalize(right)
  return witnessesOf(r).some(witness => globMatch(l, witness))
    || witnessesOf(l).some(witness => globMatch(r, witness))
}

/** Validated acquisition input after config bounds are applied. */
export interface AcquireRequest {
  readonly sessionId: string
  readonly patterns: readonly string[]
  readonly ttlMs: number
  readonly now: number
  readonly note?: string
}

/** Store-owned view of one live claim (detached copies leave the store). */
export class ClaimStore {
  private readonly claims = new Map<string, WorkspaceClaim>()
  private sequence = 0

  constructor(
    private readonly clock: Clock,
    private readonly bounds: { readonly maxTtlMs: number },
  ) {}

  /**
   * Drop expired leases.
   * @param now - current Unix epoch milliseconds; defaults to the clock.
   * @returns how many expired claims were removed.
   */
  sweep(now = this.clock()): number {
    let swept = 0
    for (const [id, claim] of this.claims) {
      if (claim.expiresAt <= now) {
        this.claims.delete(id)
        swept += 1
      }
    }
    return swept
  }

  /**
   * Take one lease. Rejects when a LIVE claim of ANOTHER session overlaps any
   * requested pattern; the caller's own overlapping claims never block.
   * @param request - validated acquisition input; TTL is capped by the bounds.
   * @returns the stored claim, detached.
   */
  acquire(request: AcquireRequest): WorkspaceClaim {
    this.sweep(request.now)
    if (request.patterns.length === 0) throw new Error('patterns must contain at least one entry')
    if (!Number.isSafeInteger(request.ttlMs) || request.ttlMs <= 0) {
      throw new Error('ttlMs must be a positive safe integer')
    }
    const ttlMs = Math.min(request.ttlMs, this.bounds.maxTtlMs)
    for (const existing of this.claims.values()) {
      if (existing.sessionId === request.sessionId) continue
      for (const pattern of request.patterns) {
        if (existing.patterns.some(owned => patternsOverlap(owned, pattern))) {
          throw new ClaimConflictError(pattern, existing)
        }
      }
    }
    this.sequence += 1
    const claim: WorkspaceClaim = {
      sessionId: request.sessionId,
      patterns: [...request.patterns],
      acquiredAt: request.now,
      expiresAt: request.now + ttlMs,
      ...(request.note === undefined ? {} : { note: request.note }),
    }
    this.claims.set(`claim-${this.sequence}`, claim)
    return { ...claim, patterns: [...claim.patterns] }
  }

  /**
   * Release every claim of one session.
   * @param sessionId - session whose claims are dropped.
   * @returns how many live claims were removed.
   */
  release(sessionId: string): number {
    let released = 0
    for (const [id, claim] of this.claims) {
      if (claim.sessionId === sessionId) {
        this.claims.delete(id)
        released += 1
      }
    }
    return released
  }

  /**
   * All live claims, earliest-expiring first; sweeps first.
   * @param now - current Unix epoch milliseconds; defaults to the clock.
   * @returns detached copies of every live claim.
   */
  list(now = this.clock()): WorkspaceClaim[] {
    this.sweep(now)
    return [...this.claims.values()]
      .sort((left, right) => left.expiresAt - right.expiresAt)
      .map(claim => ({ ...claim, patterns: [...claim.patterns] }))
  }

  /**
   * The live claim covering one concrete path, if any; insertion order breaks
   * ties so the oldest surviving claim wins. Sweeps first.
   * @param path - concrete `/`-separated path to test.
   * @param now - current Unix epoch milliseconds; defaults to the clock.
   * @returns detached copy of the covering claim, or `null`.
   */
  check(path: string, now = this.clock()): WorkspaceClaim | null {
    this.sweep(now)
    for (const claim of this.claims.values()) {
      if (claim.patterns.some(pattern => globMatch(pattern, path))) {
        return { ...claim, patterns: [...claim.patterns] }
      }
    }
    return null
  }

  /**
   * Live claim count (tests and diagnostics); sweeps first.
   * @param now - current Unix epoch milliseconds; defaults to the clock.
   * @returns how many claims are still live at `now`.
   */
  size(now = this.clock()): number {
    this.sweep(now)
    return this.claims.size
  }
}
