#!/usr/bin/env node
/** Composition driver: run one security_scan call through the mounted pipeline and print JSON. */

import type { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { boot, installFailLoud, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'

const NAME = 'security-composition-driver'
const [configPath, scanner, target] = process.argv.slice(2)
if (configPath === undefined || scanner === undefined || target === undefined) {
  throw new Error(`${NAME}: expected <config-path> <scanner> <target>`)
}

const uninstallFailLoud = installFailLoud(NAME)
let ctx: Context | undefined
try {
  ctx = await boot(NAME, resolveConfigPath(configPath, undefined))
  const result = await ctx.tools.execute({
    callId: ToolCallId('security-composition'),
    name: 'security_scan',
    arguments: { scanner, targets: [target] },
    signal: new AbortController().signal,
  })
  const text = result.content
    .map(block => (block.type === 'text' ? block.text : `<${block.type}>`))
    .join('')
  process.stdout.write(`${JSON.stringify({ type: 'result', isError: result.isError, text })}\n`)
} catch (error: unknown) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
} finally {
  await ctx?.fiber.dispose()
  uninstallFailLoud()
}
