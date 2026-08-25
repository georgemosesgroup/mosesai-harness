/**
 * Model-facing `security_scan` tool over `ctx.securityScan`. This package owns
 * the schema, prompt guidance, budgets, and presentation; the seam owns target
 * authorization, provider selection, and execution. The tool stays visible
 * when a scanner binary is missing and fails with the seam's structured error
 * at execution time (the `tool-web` precedent).
 *
 * The system-prompt section below is stable model-facing text; it is pinned
 * verbatim in this package's README.
 *
 * @module @deepseek-ai/dsh-tool-security-scan
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-security-scan'
import { SECURITY_SCANNER_IDS } from '@deepseek-ai/dsh-security-scan'
import type {
  ScanOutput,
  SecurityScanOptionValue,
  SecurityScannerId,
} from '@deepseek-ai/dsh-security-scan'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, JsonValue, ToolResult, ToolResultView } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type { SecurityScanMeta } from './types.ts'

export type { SecurityScanMeta } from './types.ts'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'tool-security-scan'

/** Services required by the security_scan tool. */
export const inject = ['tools', 'securityScan', 'systemPrompt']

/** Default cooperative tool-call timeout budget (ms); scans are long. */
export const DEFAULT_SECURITY_SCAN_TIMEOUT_MS = 600_000

/** Default cap on the complete rendered output of one scan call. */
export const DEFAULT_MAX_OUTPUT_CHARS = 20_000

/** The stable system-prompt guidance for authorized scanning. */
export const SECURITY_SCAN_PROMPT_TEXT = [
  'security_scan runs authorized vulnerability scans against resources OWNED by the user',
  '(the deployment allowlist is the authorization boundary — targets outside it fail).',
  'Recommended order: httpx to confirm live hosts, nuclei for broad templated checks,',
  'then targeted tools for specific questions. Run sqlmap only on an explicit task and',
  'prefer staging copies of applications; always pass a short note via options when relevant.',
].join(' ')

/** Plugin config: scanner enablement, timeout budget, and the output cap. */
export interface Config {
  /** Enable/disable individual scanners in the tool's enum. All default to true. */
  scanners?: Record<string, boolean>
  /** Cooperative timeout budget (ms) attached to the tool definition. */
  timeoutMs?: number
  /** Cap on the complete rendered output text. */
  maxOutputChars?: number
}

export const Config: z<Config> = z.object({
  scanners: z.dict(z.boolean()).default({}),
  timeoutMs: z.number().default(DEFAULT_SECURITY_SCAN_TIMEOUT_MS),
  maxOutputChars: z.number().default(DEFAULT_MAX_OUTPUT_CHARS),
})

type ResolvedConfig = Required<Omit<Config, 'scanners'>> & Pick<Config, 'scanners'>

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`tool-security-scan: ${name} must be a positive integer`)
  }
}

/**
 * Narrow free-form JSON option values into the seam's option vocabulary.
 * Anything else is a caller error — silently dropping an option would run a
 * different scan than the one requested.
 * @param raw - the schema-validated `options` object (open by design).
 * @returns the same entries typed for the seam request.
 */
export function toOptionValues(raw: unknown): Record<string, SecurityScanOptionValue> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
  const out: Record<string, SecurityScanOptionValue> = {}
  for (const [name, value] of Object.entries(raw)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      out[name] = value
      continue
    }
    if (Array.isArray(value) && value.every(item => typeof item === 'string')) {
      out[name] = Object.freeze([...value])
      continue
    }
    throw new Error(`option "${name}" must be a string, number, boolean, or array of strings`)
  }
  return out
}

/** The truncation footer appended when the rendered scan output exceeded the cap. */
const TRUNCATION_FOOTER = '\n\n(Output truncated. Narrow targets/options or raise maxOutputChars.)'

/**
 * The fields render/meta need from a settled scan result. Deliberately wider
 * than the seam type at its edges (`signal`, `argv` are opaque here), because
 * schema inference cannot reproduce NodeJS.Signals exactly.
 */
interface RenderableScanResult {
  readonly scanner: SecurityScannerId
  readonly exitCode: number | null
  readonly timedOut: boolean
  readonly aborted: boolean
  readonly durationMs: number
  readonly stdout: { readonly text: string; readonly truncated: boolean; readonly spillPath?: string }
  readonly stderr: { readonly text: string; readonly truncated: boolean; readonly spillPath?: string }
}

/** Render one captured stream with its spill pointer and truncation flag. */
function sectionize(output: ScanOutput): string {
  const head = output.truncated ? '[output truncated' + (output.spillPath !== undefined ? `; full stream: ${output.spillPath}` : '') + ']\n' : ''
  return `${head}${output.text}`
}

/**
 * Render a settled scan result to bounded model-facing text: header line,
 * stderr tail on non-zero exit, then stdout. The cap applies to the COMPLETE
 * text once known (the fetch-output pattern).
 *
 * @param result - the canonical scan result value.
 * @param maxOutputChars - cap on the complete returned string.
 * @returns the bounded text and whether truncation applied.
 */
export function computeScanOutput(result: RenderableScanResult, maxOutputChars: number): { text: string; truncated: boolean } {
  const header = `security_scan(${result.scanner}) exit=${result.exitCode === null ? 'signal' : String(result.exitCode)}`
    + `${result.timedOut ? ' [timed out]' : ''}${result.aborted ? ' [aborted]' : ''} (${Math.round(result.durationMs / 100) / 10}s)`
  const stderrTail = result.exitCode !== null && result.exitCode !== 0 && result.stderr.text.length > 0
    ? `\n\n[stderr tail]\n${result.stderr.text.slice(-2000)}`
    : ''
  const prefix = `${header}${stderrTail}\n\n${sectionize(result.stdout)}`
  if (prefix.length <= maxOutputChars) return { text: prefix, truncated: false }
  return {
    text: `${prefix.slice(0, Math.max(0, maxOutputChars - TRUNCATION_FOOTER.length))}${TRUNCATION_FOOTER}`,
    truncated: true,
  }
}

/** Pending-call presentation: a search-kind card titled by scanner and first targets. */
export function presentCall(args: { scanner: SecurityScannerId; targets: readonly string[] }): GenericCallView {
  return {
    card: 'generic',
    kind: 'search',
    title: `${args.scanner}: ${args.targets.slice(0, 3).join(', ')}${args.targets.length > 3 ? ', …' : ''}`,
    rawInput: args.targets,
  }
}

/** Project the canonical result into replayable meta for the completed card. */
export function metaFromValue(targetCount: number, value: RenderableScanResult, maxOutputChars: number): JsonValue {
  const { truncated } = computeScanOutput(value, maxOutputChars)
  return {
    scanner: value.scanner,
    targetCount,
    exitCode: value.exitCode,
    outputTruncated: truncated,
  }
}

/** Narrow opaque replayed meta to {@link SecurityScanMeta}; undefined on any mismatch. */
export function metaFromResult(meta: unknown): SecurityScanMeta | undefined {
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return undefined
  const candidate = meta as Record<string, unknown>
  if (typeof candidate.scanner !== 'string' || typeof candidate.targetCount !== 'number'
    || (typeof candidate.exitCode !== 'number' && candidate.exitCode !== null)
    || typeof candidate.outputTruncated !== 'boolean') {
    return undefined
  }
  return {
    scanner: candidate.scanner as SecurityScannerId,
    targetCount: candidate.targetCount,
    exitCode: candidate.exitCode,
    outputTruncated: candidate.outputTruncated,
  }
}

/** Completed-call presentation: a generic card summarizing the run from meta. */
export function presentResult(_args: { scanner: SecurityScannerId }, result: ToolResult): ToolResultView | undefined {
  if (result.isError) return undefined
  const meta = metaFromResult(result.meta)
  if (meta === undefined) return undefined
  return {
    card: 'generic',
    title: `security_scan(${meta.scanner})`,
    content: [
      { type: 'text', text: `exit ${meta.exitCode ?? 'signal'} · ${meta.targetCount} target(s)`
        + (meta.outputTruncated ? ' · output truncated' : '') },
    ],
  }
}

/** One collected-stream schema node (text + truncated + optional spillPath). */
function streamSchema(): {
  type: 'object'
  additionalProperties: false
  properties: {
    text: { type: 'string'; required: true }
    truncated: { type: 'boolean'; required: true }
    spillPath: { type: 'string' }
  }
} {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      text: { type: 'string', required: true },
      truncated: { type: 'boolean', required: true },
      spillPath: { type: 'string' },
    },
  }
}

/** Canonical result schema shared by render-time validation and inference. */
const RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    scanner: {
      type: 'string',
      required: true,
      // Keep this list in sync with SECURITY_SCANNER_IDS; a test asserts equality.
      enum: ['nuclei', 'httpx', 'katana', 'ffuf', 'nmap', 'sqlmap'],
    },
    argv: { type: 'array', required: true, items: { type: 'string' } },
    exitCode: { required: true, oneOf: [{ type: 'integer' }, { type: 'null' }] },
    signal: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
    timedOut: { type: 'boolean', required: true },
    aborted: { type: 'boolean', required: true },
    durationMs: { type: 'integer', required: true },
    stdout: { ...streamSchema(), required: true },
    stderr: { ...streamSchema(), required: true },
  },
} as const

/** Register the security_scan tool plus its system-prompt section. */
export function apply(ctx: Context, config: Config): void {
  const resolved = config as ResolvedConfig & { scanners: Partial<Record<SecurityScannerId, boolean>> }
  assertPositiveInteger('timeoutMs', resolved.timeoutMs)
  assertPositiveInteger('maxOutputChars', resolved.maxOutputChars)

  const enabled = SECURITY_SCANNER_IDS.filter(scanner => resolved.scanners[scanner] !== false)
  if (enabled.length === 0) return

  ctx.systemPrompt.section({
    name: 'tool:security_scan',
    order: 112,
    text: SECURITY_SCAN_PROMPT_TEXT,
  })

  ctx.tools.register(defineTool({
    name: 'security_scan',
    description:
      'Run an authorized security scanner against allowlisted targets you own. '
      + `Enabled scanners: ${enabled.join(', ')}. Options come from each scanner's whitelist; `
      + 'raw flags are never accepted.',
    parameters: {
      scanner: {
        type: 'string',
        required: true,
        enum: [...enabled],
        description: 'Which scanner to run.',
      },
      targets: {
        type: 'array',
        required: true,
        items: { type: 'string' },
        description: 'URLs or host[:port] strings; every host must be on this deployment allowlist.',
      },
      options: {
        type: 'object',
        additionalProperties: true,
        description: 'Scanner-specific whitelisted options (e.g. nuclei severity/tags; nmap ports). Values are validated; raw argv is impossible.',
      },
    },
    output: {
      schema: RESULT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: computeScanOutput(value, resolved.maxOutputChars).text }],
      presentationMeta: (args, value) => metaFromValue(args.targets.length, value, resolved.maxOutputChars),
    },
    timeoutMs: resolved.timeoutMs,
    // Scans load the target; keep them exclusive among sibling calls.
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const result = await ctx.securityScan.scan(
        {
          scanner: args.scanner,
          targets: args.targets,
          ...(args.options !== undefined ? { options: toOptionValues(args.options) } : {}),
        },
        exec.signal,
      )
      // Detach to the canonical shape: the schema's argv is a mutable array.
      return { ...result, argv: [...result.argv] }
    },
    presentCall,
    presentResult,
  }))
}
