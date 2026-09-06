/**
 * Per-scanner option whitelists and pure argv planning for the local
 * security-scanning provider. The model never supplies raw argv: every option
 * must appear in its scanner's whitelist, every value passes the rule's shape,
 * strings may never start with `-` (anti flag-injection), and there is NO
 * passthrough — `extraArgs` is a design-level impossibility here.
 *
 * Flag spellings were checked against the installed Homebrew builds listed in
 * the tasking (nuclei/httpx/katana/ffuf from projectdiscovery, nmap 7.991,
 * sqlmap current).
 *
 * @module dsh-security-scan-local/scanners
 */

import { SecurityScanError } from '@deepseek-ai/dsh-security-scan-moses'
import type { SecurityScannerId } from '@deepseek-ai/dsh-security-scan-moses'
import type {
  OptionRule,
  ScanArgvPlan,
  ScannerSpec,
} from './types.ts'

function optionUnknown(scanner: string, name: string, allowed: readonly string[]): SecurityScanError {
  return new SecurityScanError(
    `scanner ${scanner} has no option "${name}"; allowed options: ${allowed.join(', ')}`,
    'SECURITY_OPTION_UNKNOWN',
  )
}

function optionInvalid(scanner: string, detail: string): SecurityScanError {
  return new SecurityScanError(`scanner ${scanner}: ${detail}`, 'SECURITY_OPTION_INVALID')
}

/** A string value may never masquerade as a flag. */
function assertSafeValue(scanner: string, name: string, value: string): void {
  if (value.startsWith('-')) {
    throw optionInvalid(scanner, `option "${name}" value must not start with "-": ${JSON.stringify(value)}`)
  }
}

const NUCLEI_SEVERITIES = ['info', 'low', 'medium', 'high', 'critical'] as const

/** Runtime lookup keyed loosely so a miss is representable (Map.get → undefined). */
const SPEC_LOOKUP = new Map<string, ScannerSpec>()

/** The per-scanner whitelists. Keys are the model-facing option names. */
export const SCANNER_SPECS: Readonly<Record<SecurityScannerId, ScannerSpec>> = {
  nuclei: {
    targets: { mode: 'positional' },
    options: {
      severity: { kind: 'csv', flag: '-severity', values: [...NUCLEI_SEVERITIES] },
      tags: { kind: 'csv', flag: '-tags' },
      excludeTags: { kind: 'csv', flag: '-exclude-tags' },
      templates: { kind: 'string', flag: '-t' },
      rateLimit: { kind: 'int', flag: '-rl', min: 1 },
      concurrency: { kind: 'int', flag: '-c', min: 1 },
      retries: { kind: 'int', flag: '-retries', min: 0 },
      timeout: { kind: 'int', flag: '-timeout', min: 1 },
      json: { kind: 'boolean', flag: '-json' },
      silent: { kind: 'boolean', flag: '-silent' },
    },
    defaults: { json: true, excludeTags: 'dos' },
  },
  httpx: {
    targets: { mode: 'positional' },
    options: {
      ports: { kind: 'string', flag: '-p' },
      threads: { kind: 'int', flag: '-threads', min: 1 },
      followRedirects: { kind: 'boolean', flag: '-fr' },
      techDetect: { kind: 'boolean', flag: '-td' },
      title: { kind: 'boolean', flag: '-title' },
      silent: { kind: 'boolean', flag: '-silent' },
      json: { kind: 'boolean', flag: '-json' },
      statusCode: { kind: 'string', flag: '-sc' },
    },
    defaults: { json: true },
  },
  katana: {
    targets: { mode: 'positional' },
    options: {
      maxDepth: { kind: 'int', flag: '-d', min: 1 },
      concurrency: { kind: 'int', flag: '-c', min: 1 },
      rateLimit: { kind: 'int', flag: '-rl', min: 1 },
      delay: { kind: 'int', flag: '-delay', min: 0 },
      excludeExtensions: { kind: 'string', flag: '-ef' },
      jsFetch: { kind: 'boolean', flag: '-jf' },
      silent: { kind: 'boolean', flag: '-silent' },
    },
  },
  ffuf: {
    targets: { mode: 'none' },
    options: {
      url: { kind: 'string', flag: '-u', requiresFuzz: true },
      wordlist: { kind: 'string', flag: '-w' },
      matchStatusCodes: { kind: 'string', flag: '-mc' },
      filterStatusCodes: { kind: 'string', flag: '-fc' },
      matchSize: { kind: 'int', flag: '-ms', min: 0 },
      threads: { kind: 'int', flag: '-t', min: 1 },
      rateLimit: { kind: 'int', flag: '-rate', min: 0 },
      timeout: { kind: 'int', flag: '-timeout', min: 1 },
      quiet: { kind: 'boolean', flag: '-s' },
    },
  },
  nmap: {
    targets: { mode: 'positional' },
    options: {
      ports: { kind: 'string', flag: '-p' },
      topPorts: { kind: 'int', flag: '--top-ports', min: 1 },
      serviceDetection: { kind: 'boolean', flag: '-sV' },
      osDetection: { kind: 'boolean', flag: '-O' },
      noPing: { kind: 'boolean', flag: '-Pn' },
      udp: { kind: 'boolean', flag: '-sU' },
      timing: { kind: 'int', flag: '-T', min: 0, max: 5 },
      scripts: { kind: 'string', flag: '--script' },
    },
  },
  sqlmap: {
    targets: { mode: 'u-flag' },
    options: {
      level: { kind: 'int', flag: '--level', min: 1, max: 5 },
      risk: { kind: 'int', flag: '--risk', min: 1, max: 3 },
      threads: { kind: 'int', flag: '--threads', min: 1 },
      technique: { kind: 'string', flag: '--technique' },
      data: { kind: 'string', flag: '--data' },
      cookie: { kind: 'string', flag: '--cookie' },
      headers: { kind: 'string', flag: '--headers' },
      dbms: { kind: 'string', flag: '--dbms' },
      forms: { kind: 'boolean', flag: '--forms' },
      crawl: { kind: 'int', flag: '--crawl', min: 1 },
    },
  },
}

for (const [id, scannerSpec] of Object.entries(SCANNER_SPECS)) {
  SPEC_LOOKUP.set(id, scannerSpec)
}

/** Render one option into flag tokens; appends nothing for a false boolean. */
function renderOption(scanner: SecurityScannerId, name: string, rule: OptionRule, raw: unknown, push: (token: string) => void): void {
  switch (rule.kind) {
    case 'boolean': {
      if (typeof raw !== 'boolean') throw optionInvalid(scanner, `option "${name}" requires a boolean`)
      if (raw) push(rule.flag)
      return
    }
    case 'int': {
      if (typeof raw !== 'number' || !Number.isInteger(raw)) {
        throw optionInvalid(scanner, `option "${name}" requires an integer`)
      }
      if (rule.min !== undefined && raw < rule.min) {
        throw optionInvalid(scanner, `option "${name}" must be ≥ ${rule.min}`)
      }
      if (rule.max !== undefined && raw > rule.max) {
        throw optionInvalid(scanner, `option "${name}" must be ≤ ${rule.max}`)
      }
      push(rule.flag)
      push(String(raw))
      return
    }
    case 'string': {
      if (typeof raw !== 'string') throw optionInvalid(scanner, `option "${name}" requires a string`)
      assertSafeValue(scanner, name, raw)
      if (rule.requiresFuzz === true && !raw.includes('FUZZ')) {
        throw optionInvalid(scanner, 'ffuf url must contain the FUZZ keyword')
      }
      push(rule.flag)
      push(raw)
      return
    }
    case 'csv': {
      const items = typeof raw === 'string' ? [raw] : raw
      if (!Array.isArray(items) || items.length === 0 || !items.every(item => typeof item === 'string')) {
        throw optionInvalid(scanner, `option "${name}" requires a string or array of strings`)
      }
      for (const item of items as readonly string[]) {
        assertSafeValue(scanner, name, item)
        if (rule.values !== undefined && !rule.values.includes(item)) {
          throw optionInvalid(scanner, `option "${name}" accepts only: ${rule.values.join(', ')}`)
        }
      }
      push(rule.flag)
      push(items.join(','))
      return
    }
    /* v8 ignore next 2 -- OptionRule is a closed union; keeps adding kinds a compile error. */
    default:
      throw optionInvalid(scanner, `unsupported rule for "${name}"`)
  }
}

/** Wordlist resolution seam injected by the provider (fs-aware, test-stubbable). */
export type WordlistResolver = (rawPath: string) => string

/**
 * Plan the argv tail for one scan: `[binaryPath, ...flags, ...targets]`.
 *
 * @param scanner - the scanner to plan for.
 * @param targets - allowlist-checked targets from the runtime (already normalized hosts).
 * @param options - model-supplied options; unknown names reject with the allowed list.
 * @param resolveWordlist - resolver for ffuf's `-w` value (relative to configured dirs or absolute).
 * @returns flags plus positional targets per the placement mode; ffuf validates FUZZ + wordlist here.
 */
export function planScanArgv(
  scanner: SecurityScannerId,
  targets: readonly string[],
  options: Readonly<Record<string, unknown>> | undefined,
  resolveWordlist: WordlistResolver,
): ScanArgvPlan {
  // Map lookup keeps the miss case real for types and lint alike. The union
  // covers every id, so the miss arm is type-honest yet runtime-unreachable.
  /* v8 ignore start -- SCANNER_SPECS covers the closed SecurityScannerId union,
     so the miss arm exists for type-honesty and cannot execute. */
  const spec = SPEC_LOOKUP.get(scanner)
  if (spec === undefined) throw optionUnknown(scanner, '', [...SPEC_LOOKUP.keys()])
  /* v8 ignore stop */
  const supplied = options ?? {}
  const merged: Record<string, unknown> = { ...spec.defaults, ...supplied }

  // Required-option checks run before rendering so their errors win.
  if (spec.targets.mode === 'none') {
    if (typeof merged.url !== 'string') throw optionInvalid(scanner, 'ffuf requires the "url" option containing FUZZ')
    if (typeof merged.wordlist !== 'string') throw optionInvalid(scanner, 'ffuf requires the "wordlist" option')
  }
  if (spec.targets.mode === 'u-flag' && targets.length !== 1) {
    throw optionInvalid(scanner, `${scanner} supports exactly one target, got ${targets.length}`)
  }

  const allowedNames = Object.keys(spec.options)
  const flags: string[] = []
  for (const [name, raw] of Object.entries(merged)) {
    const rule = spec.options[name]
    if (rule === undefined) throw optionUnknown(scanner, name, allowedNames)
    if (name === 'wordlist') {
      const requestedPath = String(raw)
      if (requestedPath.startsWith('-')) {
        throw optionInvalid(scanner, `wordlist must not start with "-": ${JSON.stringify(requestedPath)}`)
      }
      const resolvedPath = resolveWordlist(requestedPath)
      flags.push('-w')
      flags.push(resolvedPath)
      continue
    }
    renderOption(scanner, name, rule, raw, token => flags.push(token))
  }

  // Non-negotiable provider policy: sqlmap must never prompt.
  if (scanner === 'sqlmap') flags.unshift('--batch')

  switch (spec.targets.mode) {
    case 'positional':
      return { flags, positionalTargets: [...targets] }
    case 'u-flag':
      /* v8 ignore next 1 -- the seam guarantees exactly one normalized target here. */
      return { flags: [...flags, '-u', targets[0] ?? ''], positionalTargets: [] }
    case 'none':
      return { flags, positionalTargets: [] }
  }
}
