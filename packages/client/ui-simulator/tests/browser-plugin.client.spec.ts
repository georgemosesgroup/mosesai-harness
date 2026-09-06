// The browser half's registrations: the simulator view tab, the keyed
// sim_screenshot toolview (claimed without a tool.call.images child), and the
// three dictionaries, all released on disposal.

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { apply, inject } from '../src/client/index.ts'
import { ScreenshotRow } from '../src/client/ScreenshotRow.tsx'
import { SimulatorPanel } from '../src/client/SimulatorPanel.tsx'
import { dicts } from '../src/client/locales.ts'

interface PresentationCapture {
  slots: SlotRegistry
  dictionaries: Array<{ namespace: string; dictionaries: unknown }>
  localeDisposed: boolean
}

/** Provide the presentation registries and capture the plugin's registrations. */
function providePresentation(ctx: Context): PresentationCapture {
  const slots = new SlotRegistry(ctx)
  slots.register({
    name: 'root',
    children: {
      'tool.call.toolview': { kind: 'keyed', scope: 'session' },
      'conversation.view': { kind: 'list', scope: 'session' },
    },
  } as never, () => null)
  const capture: PresentationCapture = { slots, dictionaries: [], localeDisposed: false }
  ctx.provide('locale', {
    register(namespace: string, dictionaries: unknown) {
      capture.dictionaries.push({ namespace, dictionaries })
      return () => { capture.localeDisposed = true }
    },
    bind: () => (key: string) => key,
  })
  return capture
}

describe('apply', () => {
  it('declares the services it binds', () => {
    expect(inject).toEqual(['slots', 'locale'])
  })

  it('registers the view tab, the sim_screenshot row, and the dictionaries; disposal releases them', async () => {
    const ctx = new Context()
    const presentation = providePresentation(ctx)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    const toolview = presentation.slots.entries('tool.call.toolview')[0]
    expect(toolview?.options).toMatchObject({ key: 'sim_screenshot' })
    expect(toolview?.locale).toBe('simulator')
    expect(toolview?.component).toBe(ScreenshotRow)
    // The row draws through the owner-supplied loader, so it must not claim the
    // single-declarant tool.call.images child.
    expect((toolview?.options as { children?: unknown }).children).toBeUndefined()

    const view = presentation.slots.entries('conversation.view')[0]
    expect(view?.options).toMatchObject({ id: 'simulator', order: 30 })
    expect(view?.component).toBe(SimulatorPanel)
    expect((view?.options as { label: () => string }).label()).toBe('view.label')
    // The panel owns its WebSocket and reads nothing from the frame: an empty inject share.
    expect(view?.inject?.()).toEqual({})

    expect(presentation.dictionaries).toEqual([{ namespace: 'simulator', dictionaries: dicts }])
    expect(Object.keys(dicts.en)).toEqual(Object.keys(dicts.ru))
    expect(Object.keys(dicts.zh)).toEqual(Object.keys(dicts.ru))

    await fiber.dispose()
    expect(presentation.slots.entries('tool.call.toolview')).toHaveLength(0)
    expect(presentation.slots.entries('conversation.view')).toHaveLength(0)
    expect(presentation.localeDisposed).toBe(true)
  })
})
