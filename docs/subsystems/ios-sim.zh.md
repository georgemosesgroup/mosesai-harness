# iOS 模拟器

[English](ios-sim.md) | 中文

[`dsh-ios-sim`](../../packages/iossim/ios-sim) 的 iOS 模拟器接缝：一个类型化的 `ctx.iosSimulator` 契约，每次组合只挂载一个提供方，能力词汇表封闭为十项，逐动词 gating 对未声明的动词以 `SIMULATOR_CAPABILITY_UNAVAILABLE` 拒绝。level-0 提供方是 [`dsh-ios-sim-simctl`](../../packages/iossim/ios-sim-simctl)，经由 `ctx.subprocess` 驱动公开的 `xcrun simctl` 表面；面向模型的消费方将其投影为 [`dsh-tool-ios-sim`](../../packages/iossim/tool-ios-sim) 的工具与 log-only 的 `iosSim/action` 事件。公开 `simctl` substrate 上的任何提供方都不可能实现 `describe` 或 `input`——`simctl` 既无触控注入也无可用性树读取——它们属于原生提供方 [`dsh-ios-sim-native`](../../packages/iossim/ios-sim-native)：它是 [iossim-helper](../../native/iossim-helper/README.zh.md) 可执行文件的瘦客户端，后者链接 FBSimulatorControl 与 FBControlCore（按 [vendoring 政策](../../vendor/README.md) 锁定）。`describe` 自 phase 2 起被服务，返回下方类型化的可用性树；`input` 自 phase 3 起被服务，执行一次手势——点按、滑动、按键、文本输入——其目标要么是前一次 `describe` 铸造的元素引用，要么是设备坐标中的一个点（level-0 对坐标目标的禁令写在没有任何提供方能实证坐标系之时；它是被取代而非被遗忘）。`stream` 自 phase 4 起被服务：`startStream` 返回实时句柄，其 `frames` 迭代器产出编码视频（编码器、帧率、缩放是真实生效的提供方配置；慢消费者丢弃最旧的块——实时语义），直至停止（[Agent Note](../../.agents/notes/implemented/architecture/2026-08-27-ios-simulator-native-provider.zh.md)）。

可用性树词汇：`SimulatorDescribeResult` 携带最前台应用的根 `SimulatorAccessibilityElement`——role、label、substrate 标识、以点为单位的 frame、enabled 状态，以及提供方铸造的索引路径 `reference`（input 动词的元素目标形式将点名它）——再加读取实证的、以点为单位的屏幕尺寸。引用在一次结果内有效；重新 describe 会对活 UI 重新分页，而针对过期引用的 input 会以 `SIMULATOR_ELEMENT_REFERENCE_STALE` 拒绝并指名修复方式。`SimulatorInputResult` 报告手势落点：元素引用解析到其 frame 中心，点目标原样落地，滑动报告起点，按键不报告落点。

Source: [`packages/iossim/ios-sim/src/index.ts`](../../packages/iossim/ios-sim/src/index.ts)


<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxiossimulator--iossimulator-abstract-seam"></a>

### `ctx.iosSimulator` — `IosSimulator` (abstract seam)

Abstract iOS-simulator service. Subclass, override the `do*` hooks for every capability you declare, and load the subclass as a plugin — it registers as `ctx.iosSimulator` (one implementation per context; loading a second throws, which is cordis' standard duplicate-service behavior).

Enforced semantics:

- Every public verb first checks capabilities; an unadvertised verb rejects with `SIMULATOR_CAPABILITY_UNAVAILABLE` naming the missing capability and the mounted provider — never a silent no-op and never an empty-answer success.
- The `do*` hooks stay defaulted (also rejecting with the same code), so a provider that advertises a capability without overriding its hooks fails equally loud instead of returning a fake result.
- `boot` and `shutdown` are idempotent power-state flips; a provider treats an already-settled target as success.
- `describe`, `input`, and `stream` are served only by providers that declare them — today the native provider over the FBSimulatorControl helper — and return typed results: the availability tree, the gesture's landing point, and a live encoded-video handle; unadvertised verbs reject through the capability gate like every other verb.

```ts cordis-catalog
/**
 * List devices visible to this provider's substrate, in substrate order.
 * @param request - the caller's request; phase 1 carries no knobs.
 * @returns every device currently listed by the provider's substrate.
 */
async list(request: SimulatorListRequest = {}): Promise<readonly SimulatorDevice[]>

/**
 * Bring the target device to a powered-on state; already-booted targets succeed.
 * @param request - the target reference (omitted = the provider's explicit resolution) with optional deadline knob.
 * @returns the target the provider actually resolved and powered on.
 */
async boot(request: SimulatorBootRequest): Promise<SimulatorResolvedTarget>

/**
 * Create a new device from a device type paired with a runtime.
 * @param request - the display name plus the device-type and runtime identifiers.
 * @returns the newly created device as `list` would observe it (shut down).
 */
async create(request: SimulatorCreateRequest): Promise<SimulatorDevice>

/**
 * List the device types and runtimes `create` can draw from on this host.
 * @returns the host's device-type and runtime catalog.
 */
async listDeviceTypes(): Promise<SimulatorDeviceCatalog>

/**
 * Power the target device off; already-shutdown targets succeed.
 * @param request - the target reference (omitted = the provider's explicit resolution) with optional deadline knob.
 * @returns the target the provider actually resolved and powered off.
 */
async shutdown(request: SimulatorShutdownRequest): Promise<SimulatorResolvedTarget>

/**
 * Deploy one application bundle onto the target device.
 * @param request - the target reference plus the host path of the application bundle to deploy.
 * @returns the target the provider actually deployed onto.
 */
async install(request: SimulatorInstallRequest): Promise<SimulatorResolvedTarget>

/**
 * Start one installed application and report what the substrate observed.
 * @param request - the target reference and the bundle identifier of an installed app.
 * @returns substrate-observed launch facts: resolved target, bundle, pid when printed, geometry or its note.
 */
async launch(request: SimulatorLaunchRequest): Promise<SimulatorLaunchResult>

/**
 * Stop one running application.
 * @param request - the target reference and the bundle identifier to stop.
 * @returns the target the provider actually resolved.
 */
async terminate(request: SimulatorTerminateRequest): Promise<SimulatorResolvedTarget>

/**
 * Capture the target device's current screen as a complete PNG raster.
 * @param request - the target reference with optional deadline knob.
 * @returns the resolved target plus the complete PNG raster and its pixel facts.
 */
async screenshot(request: SimulatorScreenshotRequest): Promise<SimulatorScreenshot>

/**
 * Open one URL through the target device's URL handler.
 * @param request - the target reference and the absolute URL to open.
 * @returns the target the provider actually resolved.
 */
async openUrl(request: SimulatorOpenUrlRequest): Promise<SimulatorResolvedTarget>

/**
 * Availability-tree read — the device's accessibility tree with stable
 * element references, served by providers that declare the `describe`
 * capability (today the native provider over the FBSimulatorControl
 * helper). A provider that does not declare it rejects through the
 * capability gate, so callers can rely on a loud error without
 * feature-testing.
 * @param request - the target reference; the explicit target-resolution step fills omissions.
 * @returns the availability tree of the resolved device, with the facts the read observed.
 */
async describe(request: SimulatorDescribeRequest): Promise<SimulatorDescribeResult>

/**
 * Structured input — one gesture (tap, swipe, key, text entry) against one
 * device, served by providers that declare the `input` capability (today
 * the native provider over the FBSimulatorControl helper's HID and
 * accessibility surfaces). The level-0 text forbade coordinate targets
 * because level 0 could not attest the coordinate space; the helper attests
 * geometry, so both target forms exist — an element reference from a
 * preceding `describe`, or a point in device coordinates. A provider that
 * does not declare the capability rejects through the gate like every other
 * verb.
 * @param request - the gesture: its action discriminator, its target, and the action's payload.
 * @returns the resolved target plus the point the gesture landed on, when one exists.
 */
async input(request: SimulatorInputRequest): Promise<SimulatorInputResult>

/**
 * Live video stream — encoded frames straight from the substrate's
 * framebuffer, served by providers that declare the `stream` capability
 * (today the native provider over the helper's VideoToolbox path). Frame
 * rate, scale, and codec come from the request and the provider's
 * configuration, with the substrate clamping what it cannot honor exactly.
 * A provider that does not declare the capability rejects through the gate.
 * @param request - the stream knobs (codec, frame rate, scale); omissions take the provider's configuration.
 * @returns a handle whose `frames` iterable yields encoded chunks until `stop`.
 */
async startStream(request: SimulatorStreamRequest = {}): Promise<SimulatorStreamHandle>
```

Source: [`packages/iossim/ios-sim/src/index.ts`](../../packages/iossim/ios-sim/src/index.ts)
<!-- END GENERATED cordis-surface -->
