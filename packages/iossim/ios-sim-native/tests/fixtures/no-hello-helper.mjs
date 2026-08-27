#!/usr/bin/env node
/**
 * Test double that exits before announcing itself — the launch-proof failure.
 * A test fixture, NOT the runtime binary.
 */
process.exit(7)
