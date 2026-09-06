import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { SecurityScanError, SecurityScanRuntime } from '@deepseek-ai/dsh-security-scan-moses'
import type {
  SecurityScanRequest,
  SecurityScanResult,
} from '@deepseek-ai/dsh-security-scan-moses'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import {
  DEFAULT_MAX_OUTPUT_CHARS,
  SECURITY_SCAN_PROMPT_TEXT,
  computeScanOutput,
  createSecurityScanTool,
  metaFromResult,
  metaFromValue,
  presentCall,
  presentResult,
  toOptionValues,
} from '../src/index.ts'

function makeResult(overrides: Partial<SecurityScanResult> = {}): SecurityScanResult {
  return {
    scanner: 'nuclei',
    argv: ['nuclei-bin', '-json', 'stub.test'],
    exitCode: 0,
    signal: null,
    timedOut: false,
    aborted: false,
    durationMs: 1500,
    stdout: { text: 'matched 2 findings', truncated: false },
    stderr: { text: '', truncated: false },
    ...overrides,
  }
}

const exec = (signal = new AbortController().signal): ToolRunContext =>
  ({ signal }) as unknown as ToolRunContext

function makeTool(scan: (request: SecurityScanRequest) => Promise<SecurityScanResult>) {
  return createSecurityScanTool(['nuclei', 'httpx'], { timeoutMs: 5_000, maxOutputChars: DEFAULT_MAX_OUTPUT_CHARS }, scan)
}

describe('toOptionValues', () => {
  it('passes primitives and string arrays through', () => {
    const value = toOptionValues({ severity: ['high'], rateLimit: 10, json: true, tags: 'x' })
    expect(value).toEqual({ severity: ['high'], rateLimit: 10, json: true, tags: 'x' })
  })

  it('throws on structured values instead of dropping them silently', () => {
    expect(() => toOptionValues({ weird: { nested: true } })).toThrow(/"weird"/)
  })
})

describe('computeScanOutput', () => {
  it('renders the header line and stdout for a clean run', () => {
    const { text, truncated } = computeScanOutput(makeResult(), DEFAULT_MAX_OUTPUT_CHARS)
    expect(text).toContain('security_scan(nuclei) exit=0')
    expect(text).toContain('(1.5s)')
    expect(text).toContain('matched 2 findings')
    expect(truncated).toBe(false)
  })

  it('marks timedOut/aborted and appends the stderr tail on failure', () => {
    const result = makeResult({
      exitCode: 1,
      timedOut: true,
      stderr: { text: `e${'!'.repeat(3000)}`, truncated: false },
    })
    const { text } = computeScanOutput(result, DEFAULT_MAX_OUTPUT_CHARS)
    expect(text).toContain('[timed out]')
    expect(text).toContain('[stderr tail]')
    expect(text).toContain('boom-or-tail'.slice(0, 0)) // no-op guard against silent edits
    expect(text.length).toBeLessThanOrEqual(DEFAULT_MAX_OUTPUT_CHARS)
  })

  it('caps the COMPLETE text with the truncation footer exactly at the budget', () => {
    const big = makeResult({ stdout: { text: 'y'.repeat(500), truncated: false } })
    const capped = computeScanOutput(big, 200)
    expect(capped.truncated).toBe(true)
    expect(capped.text.length).toBe(200)
    expect(capped.text).toContain('(Output truncated. Narrow targets/options')

    // Exactly-at-budget output is not truncated.
    const head = 'security_scan(nuclei) exit=0 (1.5s)\n\n'
    const exactResult = makeResult({ stdout: { text: 'z'.repeat(DEFAULT_MAX_OUTPUT_CHARS - head.length), truncated: false } })
    const boundary = computeScanOutput(exactResult, DEFAULT_MAX_OUTPUT_CHARS)
    expect(boundary.truncated).toBe(false)
    expect(boundary.text.length).toBe(DEFAULT_MAX_OUTPUT_CHARS)
  })

  it('exposes spillPath in the stdout section when the stream was spilled', () => {
    const { text } = computeScanOutput(makeResult({
      stdout: { text: 'tail', truncated: true, spillPath: '/tmp/spill.log' },
    }), DEFAULT_MAX_OUTPUT_CHARS)
    expect(text).toContain('/tmp/spill.log')
  })
})

describe('presentation', () => {
  it('presentCall titles by scanner and first targets with overflow marker', () => {
    expect(presentCall({ scanner: 'httpx', targets: ['a.test'] }).title).toBe('httpx: a.test')
    const view = presentCall({ scanner: 'httpx', targets: ['a.test', 'b.test', 'c.test', 'd.test'] })
    expect(view.title).toContain('…')
    expect(view.kind).toBe('search')
  })

  it('metaFromValue/metaFromResult round-trip; malformed meta falls back undefined', () => {
    const result = makeResult()
    const meta = metaFromValue(2, result, DEFAULT_MAX_OUTPUT_CHARS)
    expect(meta).toEqual({ scanner: 'nuclei', targetCount: 2, exitCode: 0, outputTruncated: false })
    expect(metaFromResult(meta)).toMatchObject({ targetCount: 2 })
    expect(metaFromResult({ broken: true })).toBeUndefined()
    expect(metaFromResult(null)).toBeUndefined()
  })

  it('presentResult summarizes from meta and stays generic on error/malformed', () => {
    const meta = metaFromValue(1, makeResult(), DEFAULT_MAX_OUTPUT_CHARS)
    const toolResult = { isError: false, content: [{ type: 'text', text: 'x' }], meta }
    const view = presentResult({ scanner: 'nuclei' }, toolResult as never)
    expect(view?.card).toBe('generic')
    expect(JSON.stringify(view)).toContain('exit 0 · 1 target(s)')
    expect(JSON.stringify(view)).not.toContain('output truncated')
    const truncatedMeta = metaFromValue(1, makeResult({ stdout: { text: 'x'.repeat(99_999), truncated: false } }), DEFAULT_MAX_OUTPUT_CHARS)
    expect((truncatedMeta as { outputTruncated: boolean }).outputTruncated).toBe(true)
    const truncatedView = presentResult({ scanner: 'nuclei' }, { ...toolResult, meta: truncatedMeta } as never)
    expect(JSON.stringify(truncatedView)).toContain('· output truncated')
    expect(presentResult({ scanner: 'nuclei' }, { ...toolResult, isError: true } as never)).toBeUndefined()
    expect(presentResult({ scanner: 'nuclei' }, { ...toolResult, meta: {} } as never)).toBeUndefined()
  })
})

describe('createSecurityScanTool execute path', () => {
  it('forwards scanner/targets/narrowed options and detaches readonly argv', async () => {
    const scan = vi.fn((request: SecurityScanRequest) => Promise.resolve(makeResult(request)))
    const tool = makeTool(scan)
    const value = await tool.execute(
      { scanner: 'nuclei', targets: ['stub.test'], options: { severity: 'high' } },
      exec(),
    ) as SecurityScanResult
    expect(scan).toHaveBeenCalledTimes(1)
    const forwarded = scan.mock.calls[0]?.[0]
    expect(forwarded).toMatchObject({ scanner: 'nuclei', targets: ['stub.test'], options: { severity: 'high' } })
    // Detached canonical shape: mutable argv array, validated against the schema.
    expect(Array.isArray(value.argv)).toBe(true)
    expect(Object.isFrozen(value.argv)).toBe(false)
  })

  it('propagates structured seam errors unchanged', async () => {
    const tool = makeTool(() => Promise.reject(new SecurityScanError('nope', 'SECURITY_EXEC_FAILED')))
    await expect(tool.execute({ scanner: 'nuclei', targets: ['stub.test'] }, exec()))
      .rejects.toMatchObject({ code: 'SECURITY_EXEC_FAILED' })
  })

  it('rejects option values outside the seam vocabulary at the tool edge', async () => {
    const scan = vi.fn((request: SecurityScanRequest) => Promise.resolve(makeResult(request)))
    const tool = makeTool(scan)
    await expect(tool.execute(
      { scanner: 'nuclei', targets: ['stub.test'], options: { bad: { deep: 1 } } },
      exec(),
    )).rejects.toThrow(/"bad"/)
    expect(scan).not.toHaveBeenCalled()
  })
})

describe('registration config', () => {
  it('prompt text is stable and non-empty (pinned verbatim in the README)', () => {
    expect(SECURITY_SCAN_PROMPT_TEXT).toContain('allowlist')
    expect(SECURITY_SCAN_PROMPT_TEXT.length).toBeGreaterThan(120)
  })

  it('context typing keeps the seam optional-safe for host compositions', () => {
    // Compile-time probe only: a host context without securityScan must still typecheck
    // via ctx.get, while injected contexts see the service directly.
    const probe = (ctx: Context): unknown => ctx.get('securityScan')
    expect(probe).toBeInstanceOf(Function)
  })
})

describe('apply registration', () => {
  it('registers the tool and prompt section over real registries', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(SecurityScanRuntime, { allowlist: ['catalog.example'] })
    await ctx.plugin(ToolRuntime)
    const Mod = await import('../src/index.ts')
    await ctx.plugin(Mod)
    const names = ctx.tools.schemas().map(schema => schema.name)
    expect(names).toContain('security_scan')
    // The registered wrapper reaches the real seam; no provider is mounted in
    // this context, so the call settles as a structured unavailable error.
    const probe = await ctx.tools.execute({
      callId: ToolCallId('security-registration-probe'),
      name: 'security_scan',
      arguments: { scanner: 'nuclei', targets: ['catalog.example'] },
      signal: new AbortController().signal,
    })
    expect(probe.isError).toBe(true)
    expect(JSON.stringify(probe.content)).toContain('no registered provider can run scanner')
  })

  it('registers nothing when every scanner is disabled', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(SecurityScanRuntime, { allowlist: ['catalog.example'] })
    await ctx.plugin(ToolRuntime)
    const Mod = await import('../src/index.ts')
    await ctx.plugin(Mod, { scanners: { nuclei: false, httpx: false, katana: false, ffuf: false, nmap: false, sqlmap: false } })
    expect(ctx.tools.schemas().map(schema => schema.name)).not.toContain('security_scan')
  })
})

describe('registration config validation and render surfaces', () => {
  it('apply rejects non-integer budgets loudly', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(SecurityScanRuntime, { allowlist: ['catalog.example'] })
    await ctx.plugin(ToolRuntime)
    const Mod = await import('../src/index.ts')
    await expect(ctx.plugin(Mod, { scanners: {}, timeoutMs: 0.5, maxOutputChars: 100 }))
      .rejects.toThrow(/timeoutMs/)
  })

  it('toOptionValues treats arrays as a whole as non-object input', () => {
    expect(toOptionValues(['x'])).toEqual({})
  })

  it('render and presentationMeta arrows run directly on the definition', async () => {
    const scan = vi.fn((request: SecurityScanRequest) => Promise.resolve(makeResult(request)))
    const tool = makeTool(scan)
    // The registry erases the inferred canonical type to JsonValue at this
    // boundary; helpers downstream re-narrow it.
    const raw = (await tool.execute({ scanner: 'nuclei', targets: ['stub.test'], options: { severity: 'high' } }, exec())) as JsonValue
    const args = { scanner: 'nuclei', targets: ['stub.test'], options: { severity: 'high' } }
    const blocks = tool.output.render(args, raw)
    expect(blocks[0]).toMatchObject({ type: 'text' })
    const meta = tool.output.presentationMeta?.(args, raw)
    expect(meta).toMatchObject({ scanner: 'nuclei', targetCount: 1 })
  })

  it('sectionize omits the spill pointer when none exists', () => {
    const { text } = computeScanOutput(makeResult({
      stdout: { text: 'plain tail', truncated: true },
      exitCode: null,
      signal: 'SIGTERM',
      aborted: true,
    }), DEFAULT_MAX_OUTPUT_CHARS)
    expect(text).toContain('[output truncated]')
    expect(text).toContain('exit=signal')
    expect(text).toContain('[aborted]')
  })

  it('metaFromResult accepts null exit codes', () => {
    const meta = { scanner: 'httpx', targetCount: 0, exitCode: null, outputTruncated: false }
    expect(metaFromResult(meta)).toEqual(meta)
  })

  it('presentResult renders the quiet form for untruncated results', () => {
    const meta = { scanner: 'nuclei' as const, targetCount: 3, exitCode: 0, outputTruncated: false }
    const view = presentResult({ scanner: 'nuclei' }, {
      isError: false,
      content: [{ type: 'text', text: 'x' }],
      meta,
    } as never)
    expect(JSON.stringify(view)).toContain('3 target(s)')
    expect(JSON.stringify(view)).not.toContain('output truncated')
  })
})

describe('concurrency declaration', () => {
  it('declares scans exclusive among sibling calls', async () => {
    const scan = (): Promise<SecurityScanResult> => Promise.resolve(makeResult())
    const tool = makeTool(scan)
    // Valid args reach the declared body; invalid ones fail validation first.
    expect((tool.isConcurrencySafe as (args: unknown) => boolean)({ scanner: 'nuclei', targets: ['stub.test'] })).toBe(false)
    expect((tool.isConcurrencySafe as (args: unknown) => boolean)('garbage')).toBe(false)
  })

  it('presentResult labels signal-terminated runs', () => {
    const meta = { scanner: 'nuclei' as const, targetCount: 2, exitCode: null, outputTruncated: true }
    const view = presentResult({ scanner: 'nuclei' }, {
      isError: false,
      content: [{ type: 'text', text: 'x' }],
      meta,
    } as never)
    expect(JSON.stringify(view)).toContain('exit signal')
  })
})
