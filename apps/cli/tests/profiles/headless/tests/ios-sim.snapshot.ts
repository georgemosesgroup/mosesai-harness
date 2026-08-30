/**
 * Keyless snapshot for the phase-1 iOS-simulator tools: one assembled
 * headless turn where the SCRIPTED model calls `sim_list` and
 * `sim_screenshot`, executed against the REAL ToolRuntime/provider stack
 * while the `xcrun` substrate is stubbed on PATH
 * (`tests/fixtures/iossim/stub/`). No live device and no API key — the
 * mock adapter (`ios-sim-mock-llm.ts`) declares image input so the
 * screenshot route gate passes keylessly.
 *
 * Asserts the durable contract end to end and pins the normalized
 * transcript: one `iosSim/action` record per action carrying reference
 * facts only (never base64), the tool/result image block pointing into
 * the durable attachment store, and the `ImageResultView` presentation
 * meta on the screenshot result.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeSessionSnapshot, type NormalizeContext } from '@deepseek-ai/dsh-session-snapshot'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const stubDir = join(here, 'fixtures', 'iossim', 'stub')
const fakeDeveloperDir = join(stubDir, 'xcode')
const overlayPath = fileURLToPath(new URL('./fixtures/iossim/iossim.cordis.yml', import.meta.url))
const binScript = fileURLToPath(new URL('./fixtures/headless-driver.ts', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))
const expectedTranscript = join(here, 'ios-sim-snapshots', 'ios-sim-tools', 'session.transcript.jsonl')
const nativeOverlayPath = fileURLToPath(new URL('./fixtures/iossim/iossim-native.cordis.yml', import.meta.url))
const nativeDriver = fileURLToPath(new URL('./fixtures/iossim/iossim-native-driver.ts', import.meta.url))
const expectedNativeTranscript = join(here, 'ios-sim-snapshots', 'ios-sim-native', 'session.transcript.jsonl')

/** Volatile values (session ids, generated cwd) the normalizer scrubs from fixtures. */
function contextFromLogs(contents: readonly string[]): NormalizeContext {
  const headers = contents.map(content => JSON.parse(content.split('\n', 1)[0] as string) as Record<string, unknown>)
  return {
    sessionIds: headers.flatMap(header => typeof header.id === 'string' ? [header.id] : []),
    cwd: typeof headers[0]?.cwd === 'string' ? headers[0].cwd : '\0no-cwd\0',
  }
}

/** The provider validates a Contents/Developer + iPhoneOS.platform layout behind `xcode-select -p`. */
function materializeStub(): void {
  mkdirSync(join(fakeDeveloperDir, 'Platforms', 'iPhoneOS.platform'), { recursive: true })
}

/** Every raw session log under the run's JSONL persistence root (any depth). */
function sessionLogs(runCwd: string): string[] {
  const root = join(runCwd, '.sessions')
  if (!existsSync(root)) return []
  const found: string[] = []
  for (const entry of readdirSync(root, { recursive: true, encoding: 'utf8' })) {
    const path = join(root, entry)
    if (statSync(path).isFile() && entry.includes('session.jsonl')) found.push(path)
  }
  return found
}


describe('ios-sim keyless snapshot (scripted model, stub substrate)', () => {
  it('runs sim_list + sim_screenshot and logs reference facts only', { timeout: LOADER_SMOKE_TEST_TIMEOUT_MS }, async () => {
    materializeStub()
    const result = await runLoaderSmoke({
      label: 'ios-sim keyless snapshot',
      tempDirPrefix: 'dsh-iossim-snapshot-',
      binScript,
      libBinScript: binScript,
      configPath: overlayPath,
      binArgs: [overlayPath, 'List simulators, then screenshot the booted one.'],
      tsconfigPath,
      env: {
        // stub/ holds executable `xcrun` and `xcode-select` shims directly.
        PATH: `${stubDir}:${process.env.PATH ?? ''}`,
        IOSIM_STUB_XCODE: fakeDeveloperDir,
        IOSIM_STUB_DIR: stubDir,
        DSH_TELEMETRY_DISABLED: '1',
        NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' '),
      },
      inspect: async (runCwd) => {
        const logs = sessionLogs(runCwd)
        expect(logs, readdirSync(runCwd).join(',')).toHaveLength(1)
        const logPath = logs[0]
        if (logPath === undefined) throw new Error('the scenario did not persist a session')
        const raw = readFileSync(logPath, 'utf8')

        // Durable action records: one per verb, reference facts only.
        const records = raw.split('\n').filter(line => line.includes('"type":"iosSim/action"'))
        expect(records).toHaveLength(2)
        expect(records.some(line => line.includes('"action":"list"') && line.includes('"devices":2'))).toBe(true)
        const shot = records.find(line => line.includes('"action":"screenshot"'))
        expect(shot).toBeDefined()
        expect(shot).toContain('"simulatorId":"STUB-A"')
        expect(shot).toContain('"mediaType":"image/png"')
        expect(shot).toMatch(/"attachmentId":"sha256:[0-9a-f]{64}"/)
        expect(raw).not.toContain('iVBORw0KGgo')

        // The tool/result content carries the committed image block, and the
        // ImageResultView presentation meta rides the result's `meta` field so
        // replay rebuilds the identical card.
        expect(raw).toContain('"type":"image"')
        expect(raw).toContain('"meta":{"device":"STUB-A"')

        // Pin the normalized transcript (snapshot) — auto-written on first run.
        const context = contextFromLogs([raw])
        const normalized = normalizeSessionSnapshot(raw, context)
        // The ImageResultView presentation meta survives normalization so
        // replay rebuilds the identical card.
        expect(normalized).toContain('"meta":{"device":"STUB-A"')
        await expect(normalized).toMatchFileSnapshot(expectedTranscript)
      },
    })
    expect(result.stdout).toContain('IOS_SIM_SNAPSHOT_OK')
  })

  it('native provider: gates the four tools, serves describe, keeps input reserved', { timeout: LOADER_SMOKE_TEST_TIMEOUT_MS }, async () => {
    const result = await runLoaderSmoke({
      label: 'ios-sim native-provider snapshot',
      tempDirPrefix: 'dsh-iossim-native-snapshot-',
      binScript: nativeDriver,
      libBinScript: nativeDriver,
      configPath: nativeOverlayPath,
      binArgs: [nativeOverlayPath, 'List simulators, then screenshot the booted one.'],
      tsconfigPath,
      env: {
        // The fixture config points the provider's helperPath override at the
        // committed protocol stub through this env fact.
        IOSIM_NATIVE_HELPER: join(here, 'fixtures', 'iossim', 'native-stub-helper.mjs'),
        DSH_TELEMETRY_DISABLED: '1',
        NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' '),
      },
      inspect: async (runCwd) => {
        const logs = sessionLogs(runCwd)
        expect(logs, readdirSync(runCwd).join(',')).toHaveLength(1)
        const logPath = logs[0]
        if (logPath === undefined) throw new Error('the scenario did not persist a session')
        const raw = readFileSync(logPath, 'utf8')

        // Rejected tool calls are gating facts, not actions: the two
        // unadvertised tools name the capability + provider. The served verbs
        // append one action record each: describe logs its element count,
        // input logs which gesture ran against which named target.
        expect(raw).toContain('does not declare the \\"list\\" capability')
        expect(raw).toContain('does not declare the \\"screenshot\\" capability')
        expect(raw).toContain('@deepseek-ai/dsh-ios-sim-native')
        const records = raw.split('\n').filter(line => line.includes('"type":"iosSim/action"'))
        expect(records.some(line => line.includes('"action":"describe"') && line.includes('"elements":3'))).toBe(true)
        expect(records.some(line => line.includes('"action":"input"') && line.includes('"inputAction":"tap"'))).toBe(true)
        expect(records.some(line => line.includes('"target":"element 0.0"'))).toBe(true)

        // The direct service probe: describe served (references issued) and
        // input tapping the first element reference lands on its frame centre.
        const probePayload = JSON.parse(readFileSync(join(runCwd, 'native-probe.json'), 'utf8')) as {
          describe: { simulatorId: string; screen: { widthPoints: number; heightPoints: number }; truncated: boolean; references: string[] }
          input: { actedAt: { xPoints: number; yPoints: number } }
        }
        expect(probePayload.describe.simulatorId).toBe('STUB-A')
        expect(probePayload.describe.screen).toEqual({ widthPoints: 393, heightPoints: 852 })
        expect(probePayload.describe.truncated).toBe(false)
        expect(probePayload.describe.references).toEqual(['0', '0.0', '0.1'])
        expect(probePayload.input).toEqual({ actedAt: { xPoints: 120, yPoints: 122 } })

        const context = contextFromLogs([raw])
        const normalized = normalizeSessionSnapshot(raw, context)
        await expect(normalized).toMatchFileSnapshot(expectedNativeTranscript)
      },
    })
    expect(result.stdout).toContain('IOSIM_NATIVE_SNAPSHOT_OK')
  })
})
