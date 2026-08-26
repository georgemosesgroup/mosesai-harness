/** Node-half placeholder for the DIF Explorer UI plugin: the browser half
 * ships via exports["./client"], discovered through the dsh.client manifest.
 * @module @deepseek-ai/dsh-client-ui-dif-explorer
 */

/**
 * Register nothing on the host plane; the plugin exists so the Loader entry
 * tree stays symmetric with every other UI package.
 */
export function apply(): void {}
