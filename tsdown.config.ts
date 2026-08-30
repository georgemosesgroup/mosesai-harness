import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig } from 'tsdown'
import { typertPlugin } from './packages/typert/generator/lib/types/tsdown-plugin.js'

function isBuildFaceClient(value: unknown): boolean {
  if (value === undefined || value === 'host') return false
  if (value === 'client') return true
  throw new Error(`tsdown: --env.DSH_BUILD_FACE must be host or client, received ${String(value)}`)
}

/**
 * Vendored directories that are build targets: membership is a manifest, not a
 * position under vendor/. Applied here as an uncommitted test-setup change.
 * @returns the vendored package directories, repository-relative.
 */
function vendoredPackages(): string[] {
  const vendor = join(import.meta.dirname, 'vendor')
  return readdirSync(vendor, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && existsSync(join(vendor, entry.name, 'package.json')))
    .map(entry => `vendor/${entry.name}`)
    .sort()
}

/**
 * The ordinary workspace build consumes JavaScript emitted by the Host
 * TypeScript project and runs Typert. The Client pass selects packages that
 * declare a browser bundle and lets their package-local configs emit both
 * their Node loader entry and browser artifact.
 */
export default defineConfig(({ env }) => {
  const client = isBuildFaceClient(env?.DSH_BUILD_FACE)
  return {
    // `vendor/idb` is a native-framework source slice (no package.json), not
    // a tsdown-built npm package; the negative glob keeps it out of the walk.
    workspace: ['vendor/*', '!vendor/idb', 'packages/*/*', 'apps/cli'],
    entry: client ? '' : ['lib/types/{index,invariant,startup}.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    plugins: client ? [] : [typertPlugin({ mode: 'workspace', faces: ['host'] })],
  }
})
