/**
 * Secret masking over text that leaves the host toward the browser. File-name
 * policy hides classic credential files outright; content policy redacts the
 * recognized material inside anything that still reaches the wire. Masking is
 * monotone: it may only shorten what a reader learns, never invent content.
 * @module @deepseek-ai/dsh-dif-explorer/secrets
 */

/** Basename patterns whose whole content is replaced with one masked notice. */
const SECRET_FILE_PATTERNS: readonly RegExp[] = [
  /^\.env($|\.)|(^|\/)\.env($|\.)/i,
  /\.(pem|key|p12|pfx|jks|keystore)$/i,
  /^id_(rsa|ed25519|ecdsa|dsa)(\..*)?$/i,
  /(^|\/)(credentials|secrets?)[^/]*\.json$/i,
]

/** Recognized secret material; every match collapses to `***`. */
const SECRET_CONTENT_PATTERNS: readonly RegExp[] = [
  // PEM / OpenSSH key blocks: header, body, footer.
  /-----BEGIN [A-Z0-9 ]+-----[\s\S]*?-----END [A-Z0-9 ]+-----/g,
  // Common provider token shapes.
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  // JWT-shaped tokens.
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\b/g,
  // KEY=value lines whose name smells like credentials (value only).
  /^\s*([\w.-]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY|ACCESS_KEY|PRIVATE_KEY)[\w.-]*)\s*=\s*(\S+)\s*$/gim,
]

const MASK = '***'

/**
 * Whether a file at `path` is a secrets file by name; the caller replaces the
 * whole content instead of pattern-scanning it.
 * @param path - any path form (the basename decides).
 * @returns true when the file is treated as pure secret material.
 */
export function isSecretFile(path: string): boolean {
  const base = path.split('/').pop() ?? path
  return SECRET_FILE_PATTERNS.some(pattern => pattern.test(path) || pattern.test(base))
}

const WHOLE_FILE_NOTICE = '\n*** This file matches the deployment secret-file policy; content is withheld. ***\n'

/**
 * Replace recognized secret material in arbitrary text.
 * @param text - the full text about to leave the host.
 * @returns the masked text plus whether at least one substitution happened.
 */
export function maskSecretText(text: string): { readonly masked: string; readonly changed: boolean } {
  let masked = text
  let changed = false
  for (const pattern of SECRET_CONTENT_PATTERNS) {
    masked = masked.replace(pattern, (...groups) => {
      // KEY=value lines keep their left side so readers see which variable was there.
      if (typeof groups[1] === 'string' && groups[2] !== undefined && typeof groups[2] === 'string') {
        changed = true
        return `${groups[1]}=${MASK}`
      }
      changed = true
      return MASK
    })
  }
  return { masked, changed }
}

/**
 * Name-first masking entry point: secrets files collapse to a notice, other
 * text passes through {@link maskSecretText}.
 * @param path - the path the content came from (drives the file policy).
 * @param text - the decoded text about to leave the host.
 * @returns the safe text plus whether masking changed anything.
 */
export function maskFileContent(path: string, text: string): { readonly masked: string; readonly changed: boolean } {
  if (isSecretFile(path)) {
    return { masked: WHOLE_FILE_NOTICE.trim(), changed: true }
  }
  return maskSecretText(text)
}
