# @deepseek-ai/dsh-client-ui-brand-moses

English | [中文](README.zh.md)

Moses-rebrand node half for `dsh web`: it serves the application icon and web manifest as immutable text assets and repoints the shell's own `<link>` elements at them through a `tapIndex` transform.

## Model Experience

None, as this package only rebrands static shell chrome; it mounts no routes that a model request could reach and contributes no prompts, schemas, or events.

#### KV Cache effect

None; nothing here participates in request assembly or history retention.

## Known Limitations and Deferred Work

- **Static assets only** — no per-deployment icon variants; changing artwork means editing this package.
- **The `<link>` repoint assumes the shipped tag shape** — a differently written shell template needs a matching regex update here.
