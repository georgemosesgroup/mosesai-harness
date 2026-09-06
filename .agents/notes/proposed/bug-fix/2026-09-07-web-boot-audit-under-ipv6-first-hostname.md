# Agent Note: Web boot audit fails under a hostname that resolves to IPv6 first

Status: proposed

English | [中文](2026-09-07-web-boot-audit-under-ipv6-first-hostname.zh.md)

## Problem

Serving the Web app under `http://dsh.localhost:4650/` (a `*.localhost` name passed through `--trusted-host`) throws `web boot: 22 entries did not activate` on every page load, while the same server opened as `http://127.0.0.1:4650/` boots cleanly. The report lists every client entry that transitively needs `sessions`, and the root of the chain is `@deepseek-ai/dsh-api-session-controller: pending (waiting for service: fileUpload)`. The `@deepseek-ai/dsh-client-file-upload` entry is not in the report, so its Loader entry is active while `ctx.get('fileUpload')` is still `undefined` at audit time.

The observed host-side difference is the transport, not the plugin roster. `dsh-host-webserver` listens on `127.0.0.1` only (IPv4). Chrome resolves `dsh.localhost` to `::1` before `127.0.0.1`; HTTP requests fall back to IPv4, but the gateway stream `new WebSocket(ws://dsh.localhost:4650/api/remote.mux)` reports `ERR_CONNECTION_REFUSED` and `[connection] connection lost, retry #N` keeps counting. The boot audit in `packages/client/web/src/boot.ts` runs right after `loader.await()` and treats a service that has not yet been provided as a permanent failure, so a transport that is still retrying turns into a boot error even though the page later renders the sidebar, sessions, and composer.

Two facts remain unexplained and must be established before a fix is chosen: why the entry that owns `fileUpload` is active while the service is absent (the `Service` base registers on construction, so either the nested fiber has not started or `ctx.get` reads a different scope), and which path mounts the application after `assertEntriesActive` threw, since `mountApp` is skipped on that path and `BootPage.fail` should keep the failure report on screen.

## Proposal

1. **Bind loopback on both families.** When `dsh-host-webserver` is configured with the loopback host, listen on `::1` as well as `127.0.0.1` (dual-stack loopback), or document that `--host` must name the IPv6 loopback for `*.localhost` names. This removes the refused WebSocket regardless of the audit.
2. **Make the audit wait for the transport.** `runPluginBoot` awaits the gateway stream reaching its first connected state (or a bounded retry budget) before `assertEntriesActive`, so the audit measures plugin health rather than network timing.
3. **Report the transport as the cause.** When the stream is still disconnected at audit time, the boot report names the failing WebSocket URL and error instead of the derived list of pending consumers.
4. **Pin the mount path on failure.** Either the failure path must not mount the app, or `BootPage.fail` must be removed once the app mounts; the current behavior shows both a console error and a working page.

## Alternatives considered

- **Drop the audit.** Loses the fail-loud signal that caught the stale-bundle roster after the 0.1.3 merge, where `fileUpload` was genuinely absent.
- **Only document `127.0.0.1`.** A trusted-host deployment exists precisely to serve a named authority, and the iOS-simulator panel fence already accepts that authority; leaving the WebSocket half broken under the same name is a partial feature.
- **Retry inside `session-controller`.** The consumer would hide a transport fault behind its own timing; the connection layer already owns retries and should be the one the audit consults.

## Acceptance criteria

- Opening the Web app under a `*.localhost` name with `--trusted-host` produces no `web boot:` error and no `remote.mux` connection failure in the console; the same holds under `127.0.0.1` and `localhost`.
- A keyless client test drives the boot with a stream that connects after a delay and asserts the audit passes; a companion case with a stream that never connects asserts the report names the transport.
- The open questions above are answered in the implemented note: which fiber owns `fileUpload` at audit time, and which path mounts the app after a failed audit.

## Risks

Dual-stack loopback changes the bind that the request-trust fence and the panel fence compare against; both must accept `[::1]` as loopback. Waiting for the transport delays boot on a genuinely unreachable server by the retry budget, so the budget must be short and reported.
