// The pure sim_screenshot row model over the frozen call block: device label
// precedence, lifecycle state, and the card's decline points, so a live call
// and a replayed log derive the identical row.

import { describe, expect, it } from 'vitest'
import type { RunningToolCall, ToolResultNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { screenshotRowModel } from '../src/client/screenshot-card-model.ts'

const ARGS = '{"device":"iPhone-17-Pro"}'
const ENVELOPE = '<device>iPhone-17-Pro</device>\n<type>screenshot</type>\n<content>\nimage/png image, 1179x2556 px. Pixels are the native raster; logical points are not reported by the public simctl surface.\n</content>'

const sampleImage = {
  attachmentId: 'sha256:0f3a1c9e6b7d8e2f4a5b6c7d8e9f0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b',
  mediaType: 'image/png',
  bytes: 412_233,
  width: 1179,
  height: 2556,
  name: 'simulator-iPhone-17-Pro.png',
}

const meta = (over?: Record<string, unknown>) => ({
  device: 'iPhone-17-Pro',
  image: { attachmentId: sampleImage.attachmentId, mediaType: 'image/png', bytes: 412_233, width: 1179, height: 2556 },
  ...over,
})

const running = (argsRaw = ARGS): RunningToolCall => ({
  callId: 'c1', name: 'sim_screenshot', argsRaw, turn: 1, step: 1, time: 1_000, subCalls: [],
})

const settled = (over?: Partial<ToolResultNode>): ToolResultNode => ({
  kind: 'tool-result', seq: 10, time: 2_000, callId: 'c1',
  call: { name: 'sim_screenshot', argsRaw: ARGS },
  callTime: 1_000,
  content: [
    { type: 'text', text: ENVELOPE },
    { type: 'image', attachment: sampleImage },
  ],
  isError: false,
  meta: meta(), subCalls: [], ...over,
} as unknown as ToolResultNode)

describe('screenshotRowModel', () => {
  it('derives the card from the settled [envelope, image] content and labels it by the persisted device', () => {
    const model = screenshotRowModel(settled())
    expect(model).toMatchObject({
      device: 'iPhone-17-Pro',
      state: 'ok',
      errorSummary: null,
      card: { images: [sampleImage], text: ENVELOPE },
    })
    // The flattened output stays available for the fallback, image block stringified and all.
    expect(model.output).toContain('<device>iPhone-17-Pro</device>')
    expect(model.output).toContain('"attachmentId"')
  })

  it('labels a running call by its device argument, and by auto when none is named yet', () => {
    expect(screenshotRowModel(running())).toMatchObject({ device: 'iPhone-17-Pro', state: 'running', card: null, output: null })
    expect(screenshotRowModel(running('{}')).device).toBe('auto')
    expect(screenshotRowModel(running('{"device":')).device).toBe('auto')
    expect(screenshotRowModel(running('[]')).device).toBe('auto')
    expect(screenshotRowModel(running('null')).device).toBe('auto')
    expect(screenshotRowModel(running('7')).device).toBe('auto')
    expect(screenshotRowModel(running('{"device":""}')).device).toBe('auto')
  })

  it('prefers the persisted device over the argument, and falls back through the argument on malformed meta', () => {
    expect(screenshotRowModel(settled({ meta: meta({ device: 'booted-A' }) })).device).toBe('booted-A')
    for (const bad of [undefined, null, 'meta', [{ device: 'x' }], {}, { device: '' }, { device: 7 }]) {
      expect(screenshotRowModel(settled({ meta: bad })).device).toBe('iPhone-17-Pro')
    }
    expect(screenshotRowModel(settled({ meta: {}, call: { name: 'sim_screenshot', argsRaw: '' } })).device).toBe('auto')
    expect(screenshotRowModel(settled({ meta: {}, call: undefined } as never)).device).toBe('auto')
  })

  it('reports error and interruption from the settled slice, with the first output line as the error summary', () => {
    const failed = screenshotRowModel(settled({
      isError: true,
      content: [{ type: 'text', text: 'cannot take a simulator screenshot: no booted device\nsecond line' }],
    } as never))
    expect(failed).toMatchObject({
      state: 'error', card: null,
      errorSummary: 'cannot take a simulator screenshot: no booted device',
    })
    const stopped = screenshotRowModel(settled({
      isError: true, content: [], error: { name: 'ToolError', code: 'interrupted' },
    }))
    expect(stopped).toMatchObject({ state: 'stopped', card: null, errorSummary: null, output: 'ToolError: interrupted' })
    const silent = screenshotRowModel(settled({ isError: true, content: [] }))
    expect(silent).toMatchObject({ state: 'error', errorSummary: null, output: null })
    const oneLine = screenshotRowModel(settled({ isError: true, content: [{ type: 'text', text: 'no booted device' }] }))
    expect(oneLine.errorSummary).toBe('no booted device')
  })

  it('keeps blocks a post-execute hook appended and joins their text', () => {
    const appended = { ...sampleImage, attachmentId: 'sha256:appended', name: 'second.png' }
    const model = screenshotRowModel(settled({
      content: [
        { type: 'text', text: ENVELOPE },
        { type: 'image', attachment: sampleImage },
        { type: 'text', text: 'analysis: the login button is visible' },
        { type: 'image', attachment: appended },
      ],
    } as never))
    expect(model.card).toEqual({
      images: [sampleImage, appended],
      text: `${ENVELOPE}\nanalysis: the login button is visible`,
    })
  })

  it('omits an absent attachment name and accepts any non-empty opaque id', () => {
    const unnamed = { ...sampleImage }
    delete (unnamed as { name?: string }).name
    const model = screenshotRowModel(settled({ content: [{ type: 'image', attachment: unnamed }] } as never))
    expect(model.card?.images[0]).not.toHaveProperty('name')
    expect(model.card?.text).toBe('')
    const opaque = screenshotRowModel(settled({ content: [{ type: 'image', attachment: { ...sampleImage, attachmentId: 'blake3:zzz' } }] } as never))
    expect(opaque.card?.images[0]?.attachmentId).toBe('blake3:zzz')
  })

  it('declines the card, keeping the flattened output, when the content is not a clean image result', () => {
    const cases: unknown[][] = [
      [{ type: 'text', text: 'no image at all' }],
      [{ type: 'reasoning', text: 'thinking' }, { type: 'image', attachment: sampleImage }],
      [{ type: 'text' }, { type: 'image', attachment: sampleImage }],
      ['not-an-object', { type: 'image', attachment: sampleImage }],
      [{ type: 'image', attachment: null }],
      [{ type: 'image', attachment: [sampleImage] }],
      [{ type: 'image', attachment: { ...sampleImage, attachmentId: '' } }],
      [{ type: 'image', attachment: { ...sampleImage, mediaType: 7 } }],
      [{ type: 'image', attachment: { ...sampleImage, bytes: 0 } }],
      [{ type: 'image', attachment: { ...sampleImage, width: 1.5 } }],
      [{ type: 'image', attachment: { ...sampleImage, height: 'tall' } }],
    ]
    for (const content of cases) {
      const model = screenshotRowModel(settled({ content } as never))
      expect(model.card).toBeNull()
      expect(model.state).toBe('ok')
      expect(model.output).not.toBeNull()
    }
  })
})
