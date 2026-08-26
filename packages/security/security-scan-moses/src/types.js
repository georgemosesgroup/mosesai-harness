/**
 * Vocabulary for the security-scanning capability seam (`ctx.securityScan`):
 * scanner identities, scan requests and results, and the provider contract.
 * Runtime classes live in `index.ts`; this module stays type-only.
 * @module dsh-security-scan/types
 */
/** Every scanner id, in registration-stable order. */
export const SECURITY_SCANNER_IDS = [
    'nuclei',
    'httpx',
    'katana',
    'ffuf',
    'nmap',
    'sqlmap',
];
//# sourceMappingURL=types.js.map