# @deepseek-ai/iossim-helper

[English](README.md) | 中文

iossim-helper npm 家族的 entry 包：ESM JavaScript，负责 helper 的路径解析（`helperPath`）与协议常量（`HELPER_PROTOCOL_VERSION`），提供方因此绝不会落后于它拉起的二进制。二进制本身随逐平台包（`darwin-arm64`、`darwin-x64`）分发，以文件路径解析，绝不被 import。线上协议与构建模型见 [workspace README](../../README.zh.md)。
