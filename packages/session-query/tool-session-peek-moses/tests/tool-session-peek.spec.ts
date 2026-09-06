import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { SessionTitleObservationResult } from '@deepseek-ai/dsh-session-query'
import { createPeekTools, resolveConfig } from '../src/index.ts'

function makeSeam(overrides: Partial<Parameters<typeof createPeekTools>[0]> = {}) {
  return {
    listSessions: vi.fn(async () => []),
    readTitleSnapshots: vi.fn(async () => [] as SessionTitleObservationResult[]),
    readSession: vi.fn(async () => { throw new Error('not found') }),
    searchSessions: vi.fn(async () => ({ items: [] })),
    searchEvents: vi.fn(async () => ({ items: [] })),
    ...overrides,
  }
}

const cfg = resolveConfig({})
const exec = { signal: new AbortController().signal } as never

describe('resolveConfig', () => {
  it('applies defaults and rejects inverted bounds', () => {
    const r = resolveConfig({})
    expect(r.defaultLimit).toBe(20)
    expect(r.maxLimit).toBe(100)
    expect(() => resolveConfig({ defaultLimit: 200, maxLimit: 100 })).toThrow(/maxLimit/)
  })
})

describe('peek tools with mocked seam', () => {
  it('list returns empty when no sessions', async () => {
    const seam = makeSeam()
    const tools = createPeekTools(seam as never, cfg)
    const value = await (tools[0]!.execute)({}, exec)
    expect(value).toMatchObject({ totalKnown: 0, returned: 0 })
  })

  it('read propagates not-found errors', async () => {
    const seam = makeSeam({
      readSession: async () => { throw new Error('session "x" not found') },
    })
    const tools = createPeekTools(seam as never, cfg)
    await expect((tools[1]!.execute)(
      { sessionId: 'x' }, exec,
    )).rejects.toThrow(/not found/)
  })
})

describe('registration', () => {
  it('registers three peek tools over real registries with a stub seam', async () => {
    const ctx = new Context()
    ctx.provide('sessionQuery', makeSeam())
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const Mod = await import('../src/index.ts')
    await ctx.plugin(Mod, {})
    const names = ctx.tools.schemas().map(schema => schema.name)
    expect(names).toContain('peek_session_list')
    expect(names).toContain('peek_session_read')
    expect(names).toContain('peek_session_search')
  })
})
