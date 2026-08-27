#!/bin/sh
# Stub `xcode-select` for the keyless iosSimulator snapshot scenario: report
# a fake developer directory laid out by prepare() (Contents/Developer +
# Platforms/iPhoneOS.platform exist under $IOSIM_STUB_XCODE).
echo "${IOSIM_STUB_XCODE:?IOSIM_STUB_XCODE not set}"
