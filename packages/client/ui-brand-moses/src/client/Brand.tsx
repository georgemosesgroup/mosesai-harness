import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { EternityMark } from './marks.tsx'

type MosesBrandMarkProps = HeroBrandMarkOwnerProps & SidebarBrandMarkOwnerProps

/**
 * Render the Moses AI mark with the presentation its host surface requests.
 * @param props - host-supplied mark presentation.
 * @returns the eternity mark.
 */
export function MosesBrandMark({ size, className }: MosesBrandMarkProps) {
  return <EternityMark size={size} className={className} />
}

/**
 * Render the product name beside the independently slotted mark. Plain text
 * rather than artwork: the name is one word pair, and text inherits the
 * sidebar's own type scale and ink instead of pinning a second raster.
 * @returns the wordmark element.
 */
export function MosesBrandName() {
  return <span>Moses AI</span>
}
