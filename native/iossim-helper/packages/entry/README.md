# @deepseek-ai/iossim-helper

English | [中文](README.zh.md)

The JavaScript seam over the prebuilt `iossim-helper` native helper: this entry package resolves the binary for the running host and owns the protocol constants the provider speaks, so a consumer never hardcodes a path or a frame version.

```js
import { HELPER_FAILURE_EXIT, HELPER_PROTOCOL_VERSION, helperPath } from '@deepseek-ai/iossim-helper';

const helper = helperPath();
// Spawn it, then read the unsolicited hello frame: a version other than
// HELPER_PROTOCOL_VERSION means refuse the helper rather than guess.
```

The binary and these constants version together in one package family, so the provider cannot fall behind the helper it launches. Policy stays with the consumer: this package does not know what a `describe` is, only where the binary lives and which protocol version it speaks. The helper exits `HELPER_FAILURE_EXIT` (`70`) on every helper-level fatal failure — bad argv, unwritable stdout, a non-serializable frame — and exits `0` when the provider closes stdin and it drains cleanly.

There are deliberately no environment-variable overrides in this module. Which binary serves simulator operations must never be decidable by the ambient environment; test injection is the provider's explicit helper-path configuration instead.

Platform packages (`os`/`cpu`-selected optional dependencies, no JavaScript inside): `@deepseek-ai/iossim-helper-darwin-arm64`, `@deepseek-ai/iossim-helper-darwin-x64`. On a host without one, `helperPath()` returns a deterministic path inside this package's own boundary that simply never exists — existence is not checked, because the provider's launch attempt is the single availability signal and a missing binary must fail exactly like a broken one.

The helper's wire protocol and its build are documented in [the workspace README](../../README.md).
