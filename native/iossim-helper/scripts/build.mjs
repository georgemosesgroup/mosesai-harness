#!/usr/bin/env node
/**
 * Builds the running architecture's `iossim-helper` binary from the vendored
 * idb framework sources (vendor/idb/, commit pinned in vendor/README.md) and
 * installs it into the matching platform package's `bin/`.
 *
 * Native-only: Xcode is the toolchain of record (xcodegen generates the
 * project from project.yml, xcodebuild compiles the four static frameworks
 * plus the helper executable into ONE self-contained binary). There is no
 * cross-toolchain — CI's per-architecture macOS runners are the builders of
 * record, mirroring the landlock-run workspace.
 *
 * Usage: node scripts/build.mjs [--arch arm64|x64] [--configuration Debug|Release]
 *                               [--derived-data <dir>] [--skip-verify]
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)

function parseArgs(argv) {
  const args = { configuration: 'Release', derivedData: join(workspaceRoot, 'Build'), skipVerify: false }
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    if (flag === '--arch') args.arch = argv[++i]
    else if (flag === '--configuration') args.configuration = argv[++i]
    else if (flag === '--derived-data') args.derivedData = resolve(argv[++i])
    else if (flag === '--skip-verify') args.skipVerify = true
    else fail(`unknown flag "${flag}"`)
  }
  return args
}

function fail(message) {
  console.error(`build.mjs: ${message}`)
  process.exit(1)
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options })
  if (result.status !== 0) {
    fail(`${command} ${args.join(' ')} failed with exit ${result.status}`)
  }
}

function expectFrameHello(binary) {
  // The functional proof: a fresh helper must announce a well-formed hello
  // frame on stdout and exit cleanly when stdin closes — a binary that cannot
  // even do that never reaches a provider.
  const child = spawnSync(binary, { input: '', timeout: 30_000, encoding: 'buffer' })
  const status = child.status
  const stdout = child.stdout ?? Buffer.alloc(0)
  if (status !== 0) {
    fail(`verification run exited ${status} (expected 0); stderr: ${child.stderr?.toString().slice(0, 400) ?? ''}`)
  }
  if (stdout.length < 4) {
    fail('verification run wrote no hello frame on stdout')
  }
  const length = stdout.readUInt32BE(0)
  let hello
  try {
    hello = JSON.parse(stdout.subarray(4, 4 + length).toString('utf8'))
  } catch {
    fail('verification run hello frame is not parseable JSON')
  }
  if (hello.helper !== 'iossim-helper' || hello.protocol !== 1 || !Array.isArray(hello.ops)) {
    fail(`verification run hello frame has unexpected content: ${JSON.stringify(hello)}`)
  }
  console.log(`verify: hello frame ok (protocol ${hello.protocol}, ops: ${hello.ops.join(', ')})`)
}

const args = parseArgs(process.argv.slice(2))
const arch = args.arch ?? process.arch
if (arch !== 'arm64' && arch !== 'x64') {
  fail(`unsupported arch "${arch}"; this helper builds for darwin arm64 and x64 only`)
}
if (process.platform !== 'darwin') {
  fail(`the helper builds on macOS only (this host is ${process.platform}); CI's macOS runners are the builders of record`)
}

console.log(`build.mjs: xcodegen generate`)
run('xcodegen', ['generate'], { cwd: workspaceRoot })

console.log(`build.mjs: xcodebuild (${args.configuration}, ${arch})`)
run('xcodebuild', [
  '-project', join(workspaceRoot, 'iossim-helper.xcodeproj'),
  '-scheme', 'iossim-helper',
  '-configuration', args.configuration,
  '-derivedDataPath', args.derivedData,
  `ARCHS=${arch}`,
  'ONLY_ACTIVE_ARCH=YES',
  'build',
])

const built = join(args.derivedData, 'Build', 'Products', args.configuration, 'iossim-helper')
const binDir = join(workspaceRoot, 'packages', `darwin-${arch}`, 'bin')
mkdirSync(binDir, { recursive: true })
rmSync(join(binDir, 'iossim-helper'), { force: true })
copyFileSync(built, join(binDir, 'iossim-helper'))
console.log(`build.mjs: installed ${join(binDir, 'iossim-helper')}`)

if (!args.skipVerify) {
  expectFrameHello(join(binDir, 'iossim-helper'))
}
console.log('build.mjs: done')
