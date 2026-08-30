---
description: "Moses AI brand occupants for the browser shell and the Russian language pack, active in the Moses web build; for maintainers choosing or replacing brand presentation and locale."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-brand-moses

English | [中文](README.zh.md)

## Summary

This package carries the Moses AI rebrand for `dsh web`: it fills the sidebar and conversation-hero brand slots with the Moses mark and name, serves the application icon and web manifest as immutable text assets, and repoints the shell's own `<link>` elements at them through a `tapIndex` transform. It also contributes the Russian language pack — a third selectable locale — to the locale runtime through `addLanguage` plus per-namespace `register`, so the shared vocabularies and the settings language row translate. The locale package itself stays upstream-identical; everything Russian lives here. Choose this package when the deployed identity is Moses AI; a deployment with a different brand composes a different package into the same slots.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

## Model Experience

None, as the rebrand plugin serves static shell chrome and a language pack; nothing enters a model request.

#### KV Cache effect

None; nothing here participates in request assembly or history retention.

## Known Limitations and Deferred Work

- **Static assets only** — no per-deployment icon variants; changing artwork means editing this package.
- **The `<link>` repoint assumes the shipped tag shape** — a differently written shell template needs a matching regex update here.

<a id="dev-note"></a>
### Dev Note

None.
