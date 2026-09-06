#!/usr/bin/env node
/**
 * Test double that closes stdout while staying alive — the framing-breach
 * classification case. A test fixture, NOT the runtime binary.
 */
process.stdout.end()
setInterval(() => {}, 1 << 30)
