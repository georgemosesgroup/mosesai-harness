/**
 * Durable vocabulary of the model-facing iOS-simulator tools: the
 * `iosSim/action` event payload and the canonical structured results. Types
 * only — runtime lives beside them ([package layout](../../../packages/AGENTS.md)).
 *
 * The event records SIMULATOR ACTIONS the model took as durable, replayable
 * intent facts. It never carries image BYTES: a screenshot's payload is a
 * plain-JSON projection of the committed `ImageAttachmentRef`, whose bytes live
 * in the durable attachment store and whose block rides `tool/result` content.
 * @module @deepseek-ai/dsh-tool-ios-sim/types
 */

/** Screenshot facts serialized into log-safe plain JSON. */
export interface SimulatorImageFacts {
  /** Content-addressed durable attachment id backing the image block. */
  attachmentId: string
  /** Declared media type (`image/png`). */
  mediaType: string
  /** Encoded size in bytes. */
  bytes: number
  /** Pixel width of the raster (native scale, not points). */
  width: number
  /** Pixel height of the raster. */
  height: number
}

/** Payload of one recorded {@link SessionEventMap iosSim/action} event. */
export interface IosSimActionEventData {
  /** Which verb produced this record. */
  action: 'list' | 'launch' | 'openurl' | 'screenshot' | 'describe' | 'input'
  /** Resolved target device reference (a UDID today), absent for `list`. */
  simulatorId?: string
  /** Substrate display name of the target, when the listing provided one. */
  simulatorName?: string
  /** Device count `list` reported (`action: 'list'`). */
  devices?: number
  /** Launched application bundle identifier (`action: 'launch'`). */
  bundleId?: string
  /** Host-side process id the substrate printed at launch, when any. */
  pid?: number
  /** URL handed to the device handler (`action: 'openurl'`). */
  url?: string
  /** Committed screenshot facts (`action: 'screenshot'`; bytes stay in the attachment store). */
  image?: SimulatorImageFacts
  /** Element count the availability tree read reported (`action: 'describe'`). */
  elements?: number
  /** The input gesture family (`action: 'input'`). */
  inputAction?: 'tap' | 'swipe' | 'key' | 'text' | 'button'
  /**
   * The target an `input` gesture acted on, as the audit record names it: an
   * element reference or a device point. The TEXT a text entry set never
   * rides here — it is user content, not a reference fact.
   */
  target?: string
}

/** Canonical structured result of `sim_list`. */
export interface SimulatorListValue {
  /** Devices visible to the substrate, substrate order preserved. */
  devices: {
    id: string
    name: string
    state: 'booted' | 'shutdown'
    runtime: string
  }[]
}

/** Canonical structured result of `sim_launch`. */
export interface SimulatorLaunchValue {
  device: { id: string; name?: string }
  bundleId: string
  pid?: number
  /** Present when the provider cannot attest point geometry; names the future source. */
  geometryNote?: string
}

/** Canonical structured result of `sim_open_url`. */
export interface SimulatorOpenUrlValue {
  device: { id: string; name?: string }
  url: string
}

/** Canonical structured result of `sim_screenshot`. */
export interface SimulatorScreenshotValue {
  device: { id: string; name?: string }
  image: SimulatorImageFacts
}

/** One availability-tree element as the `sim_describe` value reports it. */
export interface SimulatorDescribeElement {
  reference: string
  role: string
  label?: string
  identifier?: string
  frame?: { x: number; y: number; width: number; height: number }
  enabled: boolean
}

/** Canonical value of a `sim_describe` call. */
export interface SimulatorDescribeValue {
  simulatorId: string
  truncated: boolean
  screen?: { widthPoints: number; heightPoints: number }
  elements: SimulatorDescribeElement[]
}

/** Canonical value of a `sim_input` call. */
export interface SimulatorInputValue {
  simulatorId: string
  inputAction: 'tap' | 'swipe' | 'key' | 'text' | 'button'
  actedAt?: { xPoints: number; yPoints: number }
}
