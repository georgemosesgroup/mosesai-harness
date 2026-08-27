# @deepseek-ai/iossim-helper

English | [中文](README.zh.md)

The entry package of the iossim-helper npm family: ESM JavaScript owning the helper's path resolution (`helperPath`) and the protocol constants (`HELPER_PROTOCOL_VERSION`), so a provider can never fall behind the binary it launches. The binary itself ships in the per-platform packages (`darwin-arm64`, `darwin-x64`), resolved as a file path, never imported. See [the workspace README](../../README.md) for the wire protocol and build model.
