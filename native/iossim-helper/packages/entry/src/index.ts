/**
 * The JavaScript seam over the prebuilt `iossim-helper` native helper: resolve
 * the binary for this host and own the protocol constants the provider speaks.
 *
 * The helper's wire protocol (native/iossim-helper/README.md) and these
 * constants version together in one package family, so the provider cannot
 * fall behind the binary it launches. Policy stays with the consumer: this
 * package does not know what a "describe" is, only where the binary lives and
 * which protocol version it speaks.
 *
 * Deliberately no environment-variable overrides anywhere in this module:
 * which binary serves simulator operations must never be decidable by the
 * ambient environment. Test injection is the provider's explicit helper-path
 * configuration.
 */
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The helper binary's file name inside each platform package's `bin/`. */
export const HELPER_BIN = 'iossim-helper'

/**
 * The one protocol version this package family speaks: the helper announces
 * it in its unsolicited hello frame, and a provider that reads a different
 * version must refuse the helper rather than guess at frame semantics.
 */
export const HELPER_PROTOCOL_VERSION = 2

/**
 * The exit status of every helper-level fatal failure (bad argv, unwritable
 * stdout, a non-serializable frame). A zero exit means the provider closed
 * stdin and the helper drained cleanly.
 */
export const HELPER_FAILURE_EXIT = 70

/**
 * Path of the helper binary for this host: resolved from the per-platform npm
 * package `@deepseek-ai/iossim-helper-<platform>-<arch>` (npm's `os`/`cpu`
 * fields make installers fetch only the matching one). When the package is
 * not resolvable — a platform without one, or an install that skipped the
 * optional dependency — the returned fallback path points inside this
 * package's own `node_modules` and simply never exists. Existence is
 * deliberately not checked: the provider's launch attempt (waiting for the
 * hello frame) is the single availability signal, so a missing binary fails
 * exactly like a broken one.
 * @param resolvePackageJson - test hook over `require.resolve` (the default
 *   covers real installs); receives the platform package's `package.json`
 *   specifier and returns its absolute path, throwing when unresolvable.
 * @returns the absolute helper path to spawn.
 */
export function helperPath(
  resolvePackageJson: (specifier: string) => string = createRequire(import.meta.url).resolve,
): string {
  const platformPackage = `@deepseek-ai/iossim-helper-${process.platform}-${process.arch}`
  try {
    return join(dirname(resolvePackageJson(`${platformPackage}/package.json`)), 'bin', HELPER_BIN)
  } catch {
    // Unresolvable platform package: no such package exists for this host, or
    // it was not installed. Fall back to the path pnpm's layout WOULD use —
    // absolute, inside this package's boundary (never cwd-relative: a
    // spawnable relative path here would hand cwd control over which binary
    // serves simulator operations), and nonexistent exactly when the package
    // is absent.
    return join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      'node_modules',
      platformPackage,
      'bin',
      HELPER_BIN,
    )
  }
}
