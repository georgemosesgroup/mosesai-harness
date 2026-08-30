#!/usr/bin/env node
/** Snapshot-only Loader driver for the native provider: one fixture turn as
 * canonical JSONL, then a direct service probe of describe + input. */

import type { Context } from '@deepseek-ai/cordis'
import { writeFileSync } from 'node:fs'
import { boot, installFailLoud, loadEnv, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { SimulatorAccessibilityElement } from '@deepseek-ai/dsh-ios-sim'

const NAME = 'iossim-native-test-driver'
const [configPath, ...taskParts] = process.argv.slice(2)
if (configPath === undefined || taskParts.length === 0 || taskParts.every(part => part.trim() === '')) {
  throw new Error(`${NAME}: expected <config-path> <task...>`)
}

/** Every element reference the describe result issued, in walk order. */
function references(element: SimulatorAccessibilityElement): string[] {
  return [element.reference, ...element.children.flatMap(references)]
}

const uninstallFailLoud = installFailLoud(NAME)
let ctx: Context | undefined
try {
  loadEnv(NAME)
  ctx = await boot(NAME, resolveConfigPath(configPath, undefined))
  const result = await runFixtureTurn(ctx, {
    task: taskParts.join(' '),
    onEvent: (sessionId: string, event: SessionEvent) => {
      process.stdout.write(`${JSON.stringify({ type: 'session_event', sessionId, event })}\n`)
    },
  })
  process.stdout.write(`${JSON.stringify(result)}\n`)
  // Service-level probe: the model-facing tools reject unadvertised verbs (the
  // pinned transcript shows it); here the driver proves the advertised verb
  // serves the availability tree and the reserved verb still rejects. The
  // payload persists into the run cwd, which the test's inspect receives.
  const describeResult = await ctx.iosSimulator.describe({})
  const reference = describeResult.root === null ? undefined : describeResult.root.children[0]?.reference
  const input = await ctx.iosSimulator.input({
    action: reference === undefined
      ? { kind: 'tap', target: { kind: 'point', at: { xPoints: 10, yPoints: 10 } } }
      : { kind: 'tap', target: { kind: 'element', reference } },
  }).then(
    result => ({ actedAt: result.actedAt }),
    (error: unknown) => ({ code: error instanceof Error ? (error as { code?: string }).code : 'unknown' }),
  )
  const payload = {
    describe: {
      simulatorId: String(describeResult.simulatorId),
      screen: describeResult.screen,
      truncated: describeResult.truncated,
      references: describeResult.root === null ? [] : references(describeResult.root),
    },
    input,
  }
  process.stdout.write(`IOSIM_NATIVE_PROBE ${JSON.stringify(payload)}\n`)
  writeFileSync('native-probe.json', JSON.stringify(payload))
} catch (error: unknown) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
} finally {
  await ctx?.fiber.dispose()
  uninstallFailLoud()
}
