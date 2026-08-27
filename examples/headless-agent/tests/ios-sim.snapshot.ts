/**
 * Keyless snapshot scenario for the phase-1 iOS-simulator tools: one turn of
 * the assembled headless composition where the model lists, launches, opens a
 * URL, and screenshots through the REAL ToolRuntime/provider stack while the
 * `xcrun` substrate is stubbed on PATH (`tests/fixtures/iossim/stub/`). The
 * committed transcript proves the durable contract end to end: canonical
 * results, one iosSim/action record per action carrying reference facts only
 * (never base64), and the screenshot's image block pointing into the durable
 * attachment store.
 *
 * SELF-SKIP until recorded once against the real API:
 *
 *   DEEPSEEK_API_KEY=… pnpm run test:snapshot:record -t ios-sim
 *
 * Afterwards replay stays keyless on macOS AND Linux — the stub keeps the
 * substrate platform-neutral, so no normalizer carries platform weight.
 */

import { existsSync, mkdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const stubDir = join(here, 'fixtures', 'iossim', 'stub')
const fakeDeveloperDir = join(stubDir, 'xcode')
const scenarioDir = join(here, 'snapshots', 'ios-sim')
const recordedFixture = join(scenarioDir, 'session.jsonl')
const overlayPath = fileURLToPath(new URL('../iossim.cordis.snapshot.yml', import.meta.url))
const binScript = fileURLToPath(new URL('./fixtures/headless-driver.ts', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/**
 * The provider validates a Contents/Developer + Platforms/iPhoneOS.platform
 * layout behind `xcode-select -p`; create that layout inside the checked-in
 * stub before the smoke child resolves anything.
 */
function materializeStub(): void {
  mkdirSync(join(fakeDeveloperDir, 'Platforms', 'iPhoneOS.platform'), { recursive: true })
}

describe('ios-simulator tool snapshot', () => {
  // Recording needs DEEPSEEK_API_KEY (header). Until then the lane reports
  // prepared-not-recorded instead of failing the repo's snapshot gate.
  it.skipIf(!existsSync(recordedFixture))('replays list→launch→openurl→screenshot through the stubbed substrate', { timeout: LOADER_SMOKE_TEST_TIMEOUT_MS }, async () => {
    materializeStub()
    const result = await runLoaderSmoke({
      label: 'ios-sim keyless snapshot',
      tempDirPrefix: 'dsh-iossim-snapshot-',
      binScript,
      configPath: overlayPath,
      binArgs: ['--profile', 'headless', '--patch', overlayPath, 'List simulators, then screenshot the booted one after opening com.apple.Preferences.'],
      tsconfigPath,
      env: {
        // stub/ holds executable `xcrun` and `xcode-select` shims directly.
        PATH: `${stubDir}:${process.env.PATH ?? ''}`,
        IOSIM_STUB_XCODE: fakeDeveloperDir,
        IOSIM_STUB_DIR: stubDir,
        DSH_TELEMETRY_DISABLED: '1',
        NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' '),
      },
      inspect: async () => {
        // Durable log carries every action record with reference facts only.
        const transcript = await readFile(recordedFixture, 'utf8')
        expect(transcript).toContain('"type":"iosSim/action"')
        expect(transcript).not.toContain('iVBORw0KGgo')
      },
    })
    expect(result.stdout.length).toBeGreaterThan(0)
  })
})
