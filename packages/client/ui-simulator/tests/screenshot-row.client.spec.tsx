// @vitest-environment jsdom
// The keyed sim_screenshot row: summary chrome, the collapsed-by-default raster
// disclosure drawn through the owner-supplied session-authorized loader (peek
// hit, async resolve, and failure), keyboard disclosure, and the text fallback
// every non-image outcome takes.

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RunningToolCall, ToolResultNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { MessageImageLoader } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { ScreenshotRow } from '../src/client/ScreenshotRow.tsx'
import { en } from '../src/client/locales.ts'

type ScreenshotRowProps = Parameters<typeof ScreenshotRow>[0]

const t: ScreenshotRowProps['t'] = makeTranslate(en, commonZh)

afterEach(cleanup)

const ARGS = '{"device":"iPhone-17-Pro"}'
const ENVELOPE = '<device>iPhone-17-Pro</device>\n<type>screenshot</type>\n<content>\nimage/png image, 1179x2556 px.\n</content>'
const sampleImage = {
  attachmentId: 'sha256:0f3a1c9e6b7d8e2f4a5b6c7d8e9f0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b',
  mediaType: 'image/png',
  bytes: 412_233,
  width: 1179,
  height: 2556,
}

function settled(over: Partial<ToolResultNode> = {}): ToolResultNode {
  return {
    kind: 'tool-result', seq: 3, time: 3_000, callId: 'call-shot',
    call: { name: 'sim_screenshot', argsRaw: ARGS },
    callTime: 2_000,
    content: [{ type: 'text', text: ENVELOPE }, { type: 'image', attachment: sampleImage }],
    isError: false,
    meta: { device: 'iPhone-17-Pro' },
    subCalls: [],
    ...over,
  } as unknown as ToolResultNode
}

function running(): RunningToolCall {
  return { callId: 'call-shot', name: 'sim_screenshot', argsRaw: ARGS, turn: 1, step: 1, time: 2_000, subCalls: [] }
}

/** A loader whose peek answers from `cached` and whose promise is controlled by the test. */
function loader(cached?: string) {
  const resolvers: Array<{ resolve: (url: string) => void; reject: (reason: Error) => void }> = []
  const load = vi.fn(
    () => new Promise<string>((resolve, reject) => { resolvers.push({ resolve, reject }) }),
  ) as unknown as MessageImageLoader
  load.peek = vi.fn(() => cached)
  return { load, resolvers }
}

function props(block: ScreenshotRowProps['block'], loadImage: MessageImageLoader, inspect?: () => void): ScreenshotRowProps {
  return {
    callId: block.callId, toolName: 'sim_screenshot', block, openFile: vi.fn(), loadImage, inspect, t,
  } as unknown as ScreenshotRowProps
}

describe('ScreenshotRow', () => {
  it('renders the device summary and discloses the cached raster with its envelope', () => {
    const inspect = vi.fn()
    const { load } = loader('blob:cached')
    const view = render(<ScreenshotRow {...props(settled(), load, inspect)} />)
    const row = screen.getByRole('button', { name: 'ScreenshotiPhone-17-Pro' })
    expect(row.getAttribute('aria-expanded')).toBe('false')
    expect(view.container.querySelector('[data-tool="sim_screenshot"]')?.getAttribute('data-state')).toBe('ok')
    expect(screen.queryByLabelText('Screenshot result')).toBeNull()

    fireEvent.click(row)
    expect(row.getAttribute('aria-expanded')).toBe('true')
    const img = screen.getByRole('img', { name: 'Simulator screen, 1179×2556 px' })
    expect(img.getAttribute('src')).toBe('blob:cached')
    expect(img.getAttribute('width')).toBe('1179')
    // The cached URL painted first; the loader still ran once to own the reference's lifetime.
    expect(load).toHaveBeenCalledTimes(1)
    const card = screen.getByLabelText('Screenshot result')
    expect(card.textContent).toContain('1179×2556 px · 403 KB · image/png')
    expect(card.textContent).toContain('<device>iPhone-17-Pro</device>')
    expect(card.textContent).not.toContain('"attachmentId"')
    fireEvent.click(screen.getByRole('button', { name: 'Inspect' }))
    expect(inspect).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(row, { key: 'Enter' })
    expect(row.getAttribute('aria-expanded')).toBe('false')
    fireEvent.keyDown(row, { key: ' ' })
    expect(row.getAttribute('aria-expanded')).toBe('true')
    fireEvent.keyDown(row, { key: 'x' })
    expect(row.getAttribute('aria-expanded')).toBe('true')
  })

  it('loads an uncached raster through the loader, and reports a failed load without crashing', async () => {
    const { load, resolvers } = loader()
    render(<ScreenshotRow {...props(settled(), load)} />)
    fireEvent.click(screen.getByRole('button', { name: 'ScreenshotiPhone-17-Pro' }))
    expect(screen.getByText('Loading image…').getAttribute('data-raster')).toBe('loading')
    expect(load).toHaveBeenCalledWith(sampleImage)
    await act(async () => { resolvers[0]!.resolve('blob:loaded'); await Promise.resolve() })
    expect(screen.getByRole('img').getAttribute('src')).toBe('blob:loaded')

    cleanup()
    const failing = loader()
    render(<ScreenshotRow {...props(settled(), failing.load)} />)
    fireEvent.click(screen.getByRole('button', { name: 'ScreenshotiPhone-17-Pro' }))
    await act(async () => { failing.resolvers[0]!.reject(new Error('403')); await Promise.resolve() })
    expect(screen.getByText('Image unavailable').getAttribute('data-raster')).toBe('failed')
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('ignores a load that settles after the row unmounted, whether it resolves or rejects', async () => {
    for (const settle of ['resolve', 'reject'] as const) {
      const { load, resolvers } = loader()
      const view = render(<ScreenshotRow {...props(settled(), load)} />)
      fireEvent.click(screen.getByRole('button', { name: 'ScreenshotiPhone-17-Pro' }))
      view.unmount()
      await act(async () => {
        if (settle === 'resolve') resolvers[0]!.resolve('blob:late')
        else resolvers[0]!.reject(new Error('late'))
        await Promise.resolve()
      })
      expect(document.querySelector('img')).toBeNull()
      expect(document.querySelector('[data-raster]')).toBeNull()
    }
  })

  it('shows a running call as a non-expandable row with the hidden running status', () => {
    const { load } = loader()
    const view = render(<ScreenshotRow {...props(running(), load)} />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(view.container.querySelector('[data-tool="sim_screenshot"]')?.getAttribute('data-state')).toBe('running')
    expect(view.container.textContent).toContain('Capturing the simulator screen')
    expect(view.container.textContent).toContain('iPhone-17-Pro')
    fireEvent.keyDown(view.container.firstElementChild!.firstElementChild!, { key: 'Enter' })
    expect(screen.queryByLabelText('Screenshot result')).toBeNull()
  })

  it('renders the error line as the summary and discloses the flattened output', () => {
    const { load } = loader()
    const view = render(<ScreenshotRow {...props(settled({
      isError: true,
      content: [{ type: 'text', text: 'cannot take a simulator screenshot: no booted device\ndetail' }],
    } as never), load)} />)
    expect(view.container.querySelector('[data-tool="sim_screenshot"]')?.getAttribute('data-state')).toBe('error')
    expect(view.container.textContent).toContain('Screenshot failed')
    const row = screen.getByRole('button', { name: 'Screenshot failedScreenshotcannot take a simulator screenshot: no booted device' })
    fireEvent.click(row)
    const pre = screen.getByLabelText('Screenshot result').querySelector('pre')
    expect(pre?.getAttribute('data-error')).toBe('true')
    expect(pre?.textContent).toBe('cannot take a simulator screenshot: no booted device\ndetail')
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('marks an interrupted call and a silent failure without a disclosure', () => {
    const { load } = loader()
    const stopped = render(<ScreenshotRow {...props(settled({
      isError: true, content: [], error: { name: 'ToolError', code: 'interrupted' },
    }), load)} />)
    expect(stopped.container.querySelector('[data-tool="sim_screenshot"]')?.getAttribute('data-state')).toBe('stopped')
    expect(stopped.container.textContent).toContain('Screenshot stopped')
    cleanup()
    const silent = render(<ScreenshotRow {...props(settled({ isError: true, content: [] }), load)} />)
    expect(silent.container.querySelector('[data-tool="sim_screenshot"]')?.getAttribute('data-state')).toBe('error')
    expect(screen.queryByRole('button')).toBeNull()
  })
})
