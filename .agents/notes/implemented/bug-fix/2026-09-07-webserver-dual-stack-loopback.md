# Agent Note: Dual-stack loopback listener for the web server

Status: implemented

English | [中文](2026-09-07-webserver-dual-stack-loopback.zh.md)

## Problem

`dsh-host-webserver` binds `127.0.0.1` only, and its `host` schema admits nothing else on the loopback side. Chrome resolves every `*.localhost` name to `::1` before `127.0.0.1`. HTTP requests fall back to IPv4 and succeed, but `new WebSocket('ws://name.localhost:port/api/remote.mux')` reports `ERR_CONNECTION_REFUSED` and never retries on the other family. A deployment that serves the Web app under such a name through `--trusted-host` therefore loads the page, then loses the gateway stream, and the client boot audit reports every consumer of `sessions` as pending. `--host ::1` is rejected by config validation, and `0.0.0.0` is still an IPv4-only bind, so no launch flag reaches the IPv6 loopback.

## Decision

The `Config.loopbackFamilies` field (`'ipv4' | 'dual'`, default `ipv4`) selects the address families the loopback posture listens on. Under `dual` the service binds a second `node:http` server on `::1` after the `127.0.0.1` listener, on the port that listener received, so an OS-assigned port is shared. Both servers run the same request and upgrade listeners; teardown closes both and the tracked upgraded sockets. The `host` union stays `'127.0.0.1' | '0.0.0.0'`, so `ctx.webServer.host` keeps meaning the bind posture for the directory picker and the LAN-trust resolver.

Misconfiguration fails at the earliest point: `dual` with `0.0.0.0` throws in the constructor, and a `::1` bind failure rejects `[Service.init]` so the fiber fails instead of serving one family. The shipped Web bundle keeps the default; a deployment opts in through its patch layer.

## Alternatives considered

**Add `'::1'` to the `host` union.** Rejected because every consumer compares `host` with `'127.0.0.1'` to detect the loopback posture; an IPv6-only bind would also lose `127.0.0.1` clients.

**Bind `'::'` for dual-stack.** Rejected because `::` is an all-interfaces bind with `IPV6_V6ONLY` semantics that vary by platform; it would silently turn the loopback posture into network exposure.

**Enable `dual` by default.** Rejected because hosts and containers without an IPv6 loopback would fail activation; the default keeps the existing bind and the opt-in is one config key.

**Let the client fall back to IPv4 for WebSockets.** Rejected because the browser owns WebSocket address selection; the page cannot pick the family.

## Consequences

A trusted-host deployment under a `*.localhost` name gets working WebSocket upgrades by adding one key to the webserver row. The service owns two listeners under `dual`, which costs one extra socket and a second `close()` on teardown. The `ipv4` default leaves every existing composition unchanged.

Package tests pin the default IPv4-only bind, the `dual` bind on both families for HTTP and upgrades, teardown of both listeners, the `0.0.0.0` rejection, and the `::1` `EADDRINUSE` activation failure. The webserver sources are outside the per-file coverage gate; the real-Loader composition tests are the evidence.

## Deferred

The client boot audit in `packages/client/web/src/boot.ts` still runs right after `loader.await()` and reports a service that a retrying transport has not yet provided as a permanent failure. Two facts observed while diagnosing this bug remain unestablished: the `dsh-client-file-upload` entry is active while `ctx.get('fileUpload')` is `undefined` at audit time, and the application mounts after `assertEntriesActive` threw although that path skips `mountApp`. Making the audit wait for the gateway stream, naming the failing WebSocket in the boot report, and pinning the mount path on failure are separate changes; the dual-stack listener removes the trigger, not the audit's timing assumption.
