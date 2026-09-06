import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react'
import {
  IconBrowseOutline16, IconChevronDownOutline14, IconInspectOutline12, StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { MessageImageLoader } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { screenshotRowModel, type ScreenshotRowState } from './screenshot-card-model.ts'
import css from './ScreenshotRow.module.css'

type ScreenshotRowProps = ToolCallViewProps & PropsLocale<'simulator'>

/** One raster's load lifecycle: the session-authorized URL, or why there is none. */
type RasterState = { kind: 'loading' } | { kind: 'ready'; url: string } | { kind: 'failed' }

/**
 * One committed screenshot drawn through the owner-supplied loader. The loader
 * is the chat node's session-authorized `MessageImageLoader`, so this row never
 * derives a URL from the opaque attachment id itself; `peek` answers a cached
 * URL synchronously and the promise fills the rest.
 */
function Raster({ attachment, loadImage, t }: {
  attachment: ImageAttachmentRef
  loadImage: MessageImageLoader
  t: ScreenshotRowProps['t']
}) {
  const [state, setState] = useState<RasterState>(() => {
    const cached = loadImage.peek?.(attachment)
    return cached === undefined ? { kind: 'loading' } : { kind: 'ready', url: cached }
  })
  // The loader resolves a cached reference immediately, so one unconditional
  // load per (attachment, loader) pair keeps the effect free of state reads;
  // `peek` above only spares the first paint a placeholder.
  useEffect(() => {
    let live = true
    loadImage(attachment).then(
      (url) => { if (live) setState({ kind: 'ready', url }) },
      () => { if (live) setState({ kind: 'failed' }) },
    )
    return () => { live = false }
  }, [attachment, loadImage])
  const meta = `${String(attachment.width)}×${String(attachment.height)} px · ${String(Math.round(attachment.bytes / 1024))} KB · ${attachment.mediaType}`
  return (
    <figure className={css.figure}>
      {state.kind === 'ready'
        ? (
          <img
            className={css.raster}
            src={state.url}
            width={attachment.width}
            height={attachment.height}
            alt={t('shot.alt', { width: attachment.width, height: attachment.height })}
          />
        )
        : (
          <span className={css.placeholder} data-raster={state.kind}>
            {state.kind === 'loading' ? t('shot.loading') : t('shot.unavailable')}
          </span>
        )}
      <figcaption className={css.meta}>{meta}</figcaption>
    </figure>
  )
}

/** State substitution for the collapsed leading slot. */
function leadingFor(state: ScreenshotRowState): ReactNode {
  switch (state) {
    case 'error': return <StateDot state="error" />
    case 'stopped': return <StateDot state="warning" />
    default: return <IconBrowseOutline16 size={14} />
  }
}

/** Leading disclosure slot: state icon at rest, chevron on hover or while open. */
function disclosureLeading(state: ScreenshotRowState, open: boolean, expandable: boolean): ReactNode {
  if (open) return <IconChevronDownOutline14 className={css.chevron} />
  const icon = leadingFor(state)
  if (!expandable) return icon
  return (
    <>
      <span className={css.iconIdle}>{icon}</span>
      <IconChevronDownOutline14 className={`${css.chevron} ${css.chevronHover}`} />
    </>
  )
}

/** Visually hidden state copy for the colour-only lifecycle cues. */
function stateStatus(state: ScreenshotRowState, t: ScreenshotRowProps['t']): string | null {
  switch (state) {
    case 'running': return t('shot.running')
    case 'error': return t('shot.failed')
    case 'stopped': return t('shot.stopped')
    default: return null
  }
}

/**
 * Render one `sim_screenshot` call: a compact summary row naming the device,
 * and a collapsed-by-default disclosure holding the committed raster with its
 * envelope text. Rows without an image card (running, failed, interrupted, or
 * content the card declines) disclose the flattened result text instead.
 * @param props - keyed toolview payload plus the simulator locale seat.
 * @returns the dedicated screenshot row.
 */
export function ScreenshotRow({ block, loadImage, inspect, t }: ScreenshotRowProps) {
  const model = screenshotRowModel(block)
  const [expanded, setExpanded] = useState(false)
  const expandable = model.card !== null || model.output !== null
  const open = expanded && expandable
  const status = stateStatus(model.state, t)
  const summary = model.errorSummary ?? model.device
  const toggleExpand = (): void => {
    setExpanded(value => !value)
  }
  const toggleFromKeyboard = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!expandable || (event.key !== 'Enter' && event.key !== ' ')) return
    event.preventDefault()
    toggleExpand()
  }
  const disclosureProps = expandable ? {
    role: 'button' as const,
    tabIndex: 0,
    'aria-expanded': open,
    onClick: toggleExpand,
    onKeyDown: toggleFromKeyboard,
  } : {}
  const leading = disclosureLeading(model.state, open, expandable)
  return (
    <div className={css.card} data-tool="sim_screenshot" data-state={model.state}>
      <div
        className={css.row}
        data-expandable={expandable || undefined}
        {...disclosureProps}
      >
        <span className={css.leading}>{leading}</span>
        {status !== null ? <span className={css.visuallyHidden}>{status}</span> : null}
        <span className={css.title}>{t('shot.title')}</span>
        <span className={css.separator} aria-hidden />
        <span className={model.errorSummary === null ? css.summary : `${css.summary} ${css.errorSummary}`}>
          {summary}
        </span>
      </div>
      {open ? (
        <div className={css.bodyWrap}>
          <section className={css.shotCard} aria-label={t('shot.output')}>
            {model.card !== null ? (
              <div className={css.gallery}>
                {model.card.images.map(attachment => (
                  <Raster key={attachment.attachmentId} attachment={attachment} loadImage={loadImage} t={t} />
                ))}
              </div>
            ) : null}
            <pre className={css.envelope} data-error={model.state === 'error' || undefined}>
              {model.card !== null ? model.card.text : model.output}
            </pre>
          </section>
          {inspect !== undefined ? (
            <button type="button" className={css.inspectButton} onClick={inspect}>
              <IconInspectOutline12 />
              {t('shot.inspect')}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
