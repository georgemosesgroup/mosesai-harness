/**
 * Request/response vocabulary of the iOS-simulator capability seam. Every
 * mutation names its target device through {@link SimulatorId}; every result
 * reports facts the provider actually observed — an absent field means the
 * substrate did not expose that fact, never a silent zero.
 *
 * Device geometry ({@link SimulatorPointsSize}) is measured in logical POINTS
 * with the origin at the top-left corner — UIKit/AppKit coordinates, not
 * native pixels. A level-0 `simctl` provider cannot verify any point-size fact
 * (the public surface exposes no such query), so its results carry no
 * geometry; a provider that CAN attest points fills the field instead.
 * @module @deepseek-ai/dsh-ios-sim/types
 */

import type { SimulatorId } from './brand.ts'

/** Logical size of a simulated device display in points (origin top-left). */
export interface SimulatorPointsSize {
  /** Horizontal extent in points. */
  widthPoints: number
  /** Vertical extent in points. */
  heightPoints: number
}

/**
 * Confirmation every targeting verb echoes back: the target the provider
 * ACTUALLY resolved and used. Phase-2 availability-tree work builds on these
 * confirmed ids, so no verb leaves its caller guessing which device ran.
 */
export interface SimulatorResolvedTarget {
  /** The resolved-and-used target reference. */
  simulatorId: SimulatorId
}

/** Power state of one listed device. */
export type SimulatorState = 'booted' | 'shutdown'

/** One device as `list` observed it. */
export interface SimulatorDevice {
  /** Stable device reference usable as the target of every other verb. */
  id: SimulatorId
  /** User-assigned or derived display name (e.g. `iPhone 15 Pro`). */
  name: string
  /** Power state at listing time; a later boot/shutdown by another actor can stale it. */
  state: SimulatorState
  /** Substrate-native product-type identifier (e.g. `com.apple.CoreSimulator.SimDeviceType.iPhone-15-Pro`). */
  deviceTypeIdentifier: string
  /** Substrate-native OS-runtime identifier (e.g. `com.apple.CoreSimulator.SimRuntime.iOS-17-5`). */
  runtimeIdentifier: string
}

/** One installable device type as `listDeviceTypes` observed it. */
export interface SimulatorDeviceType {
  /** Substrate-native identifier passed to `create` (e.g. `com.apple.CoreSimulator.SimDeviceType.iPhone-15-Pro`). */
  identifier: string
  /** Display name (e.g. `iPhone 15 Pro`). */
  name: string
}

/** One OS runtime `create` can pair a device type with. */
export interface SimulatorRuntime {
  /** Substrate-native identifier passed to `create` (e.g. `com.apple.CoreSimulator.SimRuntime.iOS-17-5`). */
  identifier: string
  /** Display name (e.g. `iOS 17.5`). */
  name: string
  /** Whether the runtime is installed and usable; an unavailable runtime cannot back a new device. */
  available: boolean
}

/** The catalog `create` draws from: which device types and runtimes exist on this host. */
export interface SimulatorDeviceCatalog {
  /** Every device type the host advertises, in substrate order. */
  deviceTypes: readonly SimulatorDeviceType[]
  /** Every OS runtime the host advertises, in substrate order. */
  runtimes: readonly SimulatorRuntime[]
}

/** `create` request — a new device from a device type paired with a runtime. */
export interface SimulatorCreateRequest {
  /** Display name for the new device. */
  name: string
  /** Device-type identifier from {@link SimulatorDeviceType.identifier}. */
  deviceTypeIdentifier: string
  /** Runtime identifier from {@link SimulatorRuntime.identifier}. */
  runtimeIdentifier: string
}

/** Base for every verb that targets one device. */
export interface SimulatorTargetedRequest {
  /**
   * Target device. Omitted fields are filled by the implementation's explicit
   * target-resolution step — never by a hidden default inside the verb call.
   */
  simulator?: SimulatorId | undefined
  /**
   * Substrate-call deadline override in milliseconds for trusted in-process
   * callers; capped by the provider's configuration. Not a model-facing tool
   * parameter (the shell request/spec split is the owning template).
   */
  timeoutMs?: number | undefined
}

/** `list` request; empty today, kept object-shaped for forward-compatible knobs. */
export interface SimulatorListRequest {}

/** `boot` request: bring the named (or explicitly resolved) device to a powered-on state. */
export interface SimulatorBootRequest extends SimulatorTargetedRequest {}

/** `shutdown` request: power the named device off. Idempotent for an already-off device. */
export interface SimulatorShutdownRequest extends SimulatorTargetedRequest {}

/** `install` request: deploy one application bundle onto the device. */
export interface SimulatorInstallRequest extends SimulatorTargetedRequest {
  /** Host path of the application bundle (.app directory or .ipa archive), interpreted by the provider. */
  appPath: string
}

/** `launch` request: start one installed application by bundle identifier. */
export interface SimulatorLaunchRequest extends SimulatorTargetedRequest {
  /** Bundle identifier of an app ALREADY INSTALLED on the target (install first). */
  bundleId: string
}

/** Result of {@link SimulatorLaunchRequest}: what the provider observed about the launched process. */
export interface SimulatorLaunchResult {
  /** The target the provider actually resolved and used — required on every result. */
  simulatorId: SimulatorId
  /** The bundle identifier that was launched (echoes the request). */
  bundleId: string
  /** Host-side pid the substrate reported for the app process, when it printed one. */
  pid?: number | undefined
  /**
   * Device display size in POINTS (origin top-left) when the provider has a
   * verifiable source for it. Level-0 `simctl` providers cannot attest any
   * point-size fact, so they leave this unset and fill {@link geometryNote}.
   */
  geometry?: SimulatorPointsSize | undefined
  /**
   * Present exactly when {@link geometry} is unset: why the provider cannot
   * attest points and which surface would provide them.
   */
  geometryNote?: string | undefined
}

/** `terminate` request: stop one running application by bundle identifier. */
export interface SimulatorTerminateRequest extends SimulatorTargetedRequest {
  /** Bundle identifier of the app to stop. */
  bundleId: string
}

/** Result of `screenshot`: the resolved target plus the captured raster facts. */
export interface SimulatorScreenshot {
  /** The target the provider actually captured — required on every result. */
  simulatorId: SimulatorId
  /** Complete image file bytes as the substrate produced them (PNG for current providers). */
  data: Uint8Array
  /** Declared media type of {@link data}. */
  mediaType: 'image/png'
  /** Pixel width of {@link data} (native raster scale, NOT points). */
  widthPx: number
  /** Pixel height of {@link data}. */
  heightPx: number
}

/** `openUrl` request: open one URL through the device's URL handler. */
export interface SimulatorOpenUrlRequest extends SimulatorTargetedRequest {
  /** Absolute URL accepted by the substrate's open handler (e.g. `https://`, a custom scheme). */
  url: string
}

/** `describe` request — targets one device; the payload surface stays object-shaped for future knobs. */
export interface SimulatorDescribeRequest extends SimulatorTargetedRequest {}

/** Frame of one availability-tree element, in POINTS with the origin at the top-left corner. */
export interface SimulatorElementFrame {
  /** Horizontal offset of the element's leading edge, in points. */
  xPoints: number
  /** Vertical offset of the element's top edge, in points. */
  yPoints: number
  /** Horizontal extent in points. */
  widthPoints: number
  /** Vertical extent in points. */
  heightPoints: number
}

/**
 * One element of the device availability tree as `describe` observed it. Every
 * fact is substrate-reported — the framework reads the accessibility tree, no
 * raster is parsed — and an attribute the element does not carry is absent,
 * never a silent zero.
 */
export interface SimulatorAccessibilityElement {
  /**
   * Stable element reference within THIS describe result: the address the
   * input verb's element-target form names. Derived by the provider from the
   * tree walk; a later describe re-reads a live UI and may repaginate, so a
   * reference is meaningful only against the result that issued it.
   */
  reference: string
  /** Substrate-native accessibility identifier, when the app declares one. */
  identifier?: string | undefined
  /** Normalized accessibility role (e.g. `Button`, `TextField`, `Window`). */
  role: string
  /** Accessibility label, when the element carries one. */
  label?: string | undefined
  /** Element frame in points; absent when the substrate cannot attest it. */
  frame?: SimulatorElementFrame | undefined
  /** Whether the element currently accepts interaction. */
  enabled: boolean
  /** Child elements in substrate order; empty for leaves. */
  children: readonly SimulatorAccessibilityElement[]
}

/** Result of `describe`: the availability tree of one device, plus what the read observed. */
export interface SimulatorDescribeResult {
  /** The target the provider actually resolved and read — required on every result. */
  simulatorId: SimulatorId
  /**
   * The root of the frontmost application's element tree, or `null` when the
   * read found no frontmost application to report (a quiet springboard is a
   * successful empty read, not a failure).
   */
  root: SimulatorAccessibilityElement | null
  /**
   * Device display size in POINTS (origin top-left) when the read attested it
   * — the geometry fact the level-0 contract named the availability tree as
   * the future source of.
   */
  screen?: SimulatorPointsSize | undefined
  /** True when the substrate's read was cut short (depth/element caps), so the tree is partial. */
  truncated: boolean
}

/**
 * One device-coordinate point, in POINTS with the origin at the top-left
 * corner — the coordinate space the availability tree's frames and the
 * helper's gestures share.
 */
export interface SimulatorPoint {
  xPoints: number
  yPoints: number
}

/**
 * The target one input gesture acts on. Both forms exist from the input
 * verb's first commit: an element reference issued by a preceding `describe`
 * (resolved by the provider against its cached result), or a point in device
 * coordinates — the form a person clicking a picture has, and the form the
 * level-0 contract text forbade until geometry became attested
 * ([Agent Note](../../../../.agents/notes/implemented/architecture/2026-08-27-ios-simulator-native-provider.md)).
 */
export type SimulatorInputTarget =
  | { readonly kind: 'element'; reference: string }
  | { readonly kind: 'point'; at: SimulatorPoint }

/**
 * One input gesture. `tap` and `text` act on a target; `swipe` drags between
 * two points; `key` presses one hardware key by its HID usage code — the
 * framework's own currency for keyboard events.
 */
/** Swipe drags between two device points over the configured duration. */
export interface SimulatorInputSwipe {
  readonly kind: 'swipe'
  start: SimulatorPoint
  end: SimulatorPoint
  durationMs?: number | undefined
}

/**
 * One input gesture. `tap` and `text` act on a target; `swipe` drags between
 * two points; `key` presses one hardware key by its HID usage code — the
 * framework's own currency for keyboard events.
 */
/**
 * One hardware button, named as the substrate names them. `home` and `lock`
 * exist on every simulated device; the rest act only where the simulated
 * hardware carries them.
 */
export type SimulatorHardwareButton = 'home' | 'lock' | 'side_button' | 'siri' | 'apple_pay' | 'play_pause'

/**
 * One input gesture, discriminated by `kind`. A tap or text entry names its
 * target (an element reference or a device point); a swipe carries its
 * endpoints; a key press carries an HID usage with an optional shift hold; a
 * button press names a hardware button.
 */
export type SimulatorInputAction =
  | { readonly kind: 'tap'; target: SimulatorInputTarget }
  | SimulatorInputSwipe
  | { readonly kind: 'key'; usage: number; shift?: boolean | undefined }
  | { readonly kind: 'button'; button: SimulatorHardwareButton }
  | { readonly kind: 'text'; target: SimulatorInputTarget; text: string }

/**
 * `input` request — one gesture against one device. A gesture is
 * model-visible when it reaches the model-facing tool, which appends the
 * `iosSim/action` record; a person driving the panel calls the same verb and
 * never produces that record
 * ([Agent Note](../../../../.agents/notes/implemented/architecture/2026-08-27-ios-simulator-native-provider.md)).
 */
export interface SimulatorInputRequest extends SimulatorTargetedRequest {
  action: SimulatorInputAction
}

/** Result of `input`: the resolved target plus where the gesture actually landed. */
export interface SimulatorInputResult {
  /** The target the provider actually resolved and used — required on every result. */
  simulatorId: SimulatorId
  /**
   * The device point the gesture landed on, when the gesture has one point of
   * contact: an element reference resolves to its frame's centre, a point
   * target passes through. A swipe reports its start; a key press reports no
   * point at all.
   */
  actedAt?: SimulatorPoint | undefined
}

/** The video codec a live stream encodes with. */
export type SimulatorStreamCodec = 'h264' | 'hevc' | 'mjpeg'

/**
 * `stream` request — one live video stream of one device. Every knob is
 * optional: the mounted provider's configuration supplies the defaults, and
 * the substrate clamps what it cannot honor exactly.
 */
export interface SimulatorStreamRequest extends SimulatorTargetedRequest {
  /** Video codec. Default: the provider's configured codec. */
  codec?: SimulatorStreamCodec | undefined
  /** Encode at most this many frames per second. Default: the provider's configured rate. */
  frameRate?: number | undefined
  /** Resolution scale of the encoded output, `1` = native points × native scale. Default: the provider's configured scale. */
  scale?: number | undefined
}

/**
 * One live video stream. `frames` yields encoded chunks exactly as the
 * substrate produced them — a live surface, so a slow consumer loses chunks
 * rather than growing an unbounded buffer. `stop` releases the substrate
 * resources; the iterable ends after it.
 */
export interface SimulatorStreamHandle {
  /** The codec the substrate actually negotiated. */
  codec: SimulatorStreamCodec
  /** Encoded video chunks (codec container framing, e.g. Annex-B for h264). */
  frames: AsyncIterable<Uint8Array>
  /** Stop the stream; idempotent. */
  stop(): Promise<void>
}
