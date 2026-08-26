import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const driverScript = fileURLToPath(new URL('./fixtures/security-driver.ts', import.meta.url))
const configPath = fileURLToPath(
  new URL('../../../../examples/headless-agent/tests/fixtures/security/tool-security-scan/cordis.yml', import.meta.url),
)
const specDir = dirname(fileURLToPath(import.meta.url))
// Explicit climb: tests/ → tool-security-scan → security → packages.
const stubBin = join(specDir, '..', '..', 'security-scan-local', 'tests', 'fixtures', 'bin', 'scanner-stub')
if (!existsSync(stubBin)) {
  throw new Error(`scanner stub fixture missing at ${stubBin}`)
}
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

let scratchRoot: string

beforeAll(() => {
  // Stable scratch for the provider cwd/wordlistDirs; the smoke itself runs
  // in its own temp directory.
  scratchRoot = mkdtempSync(join(tmpdir(), 'security-composition-'))
  mkdirSync(join(scratchRoot, 'cwd'), { recursive: true })
})

afterAll(() => {
  rmSync(scratchRoot, { recursive: true, force: true })
})

/** Boot the three-package composition through the real Loader and run one security_scan call. */
async function runComposition(scanner: string, target: string): Promise<{ isError: boolean; text: string }> {
  const { stdout } = await runLoaderSmoke({
    label: `security-composition-${scanner}`,
    tempDirPrefix: 'security-composition-e2e-',
    binScript: driverScript,
    libBinScript: driverScript,
    configPath,
    binArgs: [configPath, scanner, target],
    tsconfigPath: repoTsconfig,
    env: {
      SECURITY_STUB_BIN: stubBin,
      SECURITY_STUB_CWD: join(scratchRoot, 'cwd'),
    },
  })
  const last = stdout.trimEnd().split('\n').at(-1) ?? ''
  const parsed = JSON.parse(last) as { type: string; isError: boolean; text: string; stubBin?: string; cwd?: string }
  expect(parsed.type).toBe('result')
  return parsed
}

describe('security_scan through a real cordis.yml (Loader boot)', () => {
  it.skipIf(process.platform === 'win32')('runs an allowlisted target end-to-end to the stub binary', async () => {
    const parsed = await runComposition('nuclei', 'https://stub.test/scan')
    expect(parsed.isError, parsed.text).toBe(false)
    // The stub prints nothing without STUB_* env, so the clean header IS the
    // success signal here.
    expect(parsed.text).toContain('security_scan(nuclei) exit=0')
    expect(parsed.text).not.toContain('isError\": true')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it.skipIf(process.platform === 'win32')('rejects a non-allowlisted target before any provider runs', async () => {
    const parsed = await runComposition('httpx', 'https://evil.example.net/')
    expect(parsed.isError).toBe(true)
    // The model-facing content carries the message; the structured code stays
    // on the thrown HarnessError inside the seam boundary.
    expect(parsed.text).toContain("is not on this deployment's authorized allowlist")
    expect(parsed.text).toContain('evil.example.net')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
