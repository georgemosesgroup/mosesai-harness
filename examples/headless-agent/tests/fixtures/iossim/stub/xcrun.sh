#!/bin/sh
# Stub `xcrun` for the keyless iosSimulator snapshot scenario. Only the
# subcommands the phase-1 provider allowlists ever reach here.
set -eu
[ "$1" = simctl ] || { echo "stub xcrun: unsupported call: $*" >&2; exit 64; }
shift
case "$1" in
  list)
    # Device list accepts --json; output is stable and shell-scriptable.
    while [ $# -gt 0 ]; do shift; done
    cat "$IOSIM_STUB_DIR/fixtures/devices.json"
    ;;
  launch|terminate|openurl)
    echo "com.apple.Preferences" ; exit 0 ;;
  io)
    # io <udid> screenshot --type=png <file>
    for arg in "$@"; do file=$arg; done
    cp "$IOSIM_STUB_DIR/fixtures/screen.png" "$file"
    exit 0 ;;
  *)
    echo "stub xcrun: blocked subcommand $1" >&2; exit 69 ;;
esac
