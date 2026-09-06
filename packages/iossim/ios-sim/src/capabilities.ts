/**
 * Capability vocabulary of the iOS-simulator seam: what a provider declares
 * about itself and which declared capability gates each contract verb.
 *
 * Method names and capability names deliberately differ in one place, logged
 * here:
 * - `shutdown` rides the `'boot'` capability — power-state flip in both
 *   directions is one substrate lifecycle ability.
 *
 * @module @deepseek-ai/dsh-ios-sim/capabilities
 */

/**
 * One substrate ability a provider may declare. The set is CLOSED here on
 * purpose: consumers switch over it, so a new phase extension edits this file
 * together with every consumer branch instead of growing silent strings.
 */
export type SimulatorCapability =
  | 'list'
  | 'boot'
  | 'create'
  | 'install'
  | 'launch'
  | 'terminate'
  | 'screenshot'
  | 'openUrl'
  | 'describe'
  | 'input'
  | 'stream'

/** Closed set of {@link SimulatorCapability} values, in contract order. */
export const SIMULATOR_CAPABILITIES: readonly SimulatorCapability[] = [
  'list',
  'boot',
  'create',
  'install',
  'launch',
  'terminate',
  'screenshot',
  'openUrl',
  'describe',
  'input',
  'stream',
] as const

/** A contract verb callable on {@link IosSimulator}; the gating map below ties it to a capability. */
export type SimulatorVerb =
  | 'list'
  | 'boot'
  | 'shutdown'
  | 'create'
  | 'listDeviceTypes'
  | 'install'
  | 'launch'
  | 'terminate'
  | 'screenshot'
  | 'openUrl'
  | 'describe'
  | 'input'
  | 'stream'

/**
 * Verb → gate capability. Exhaustive over {@link SimulatorVerb}: adding a verb
 * or changing a mapping is a compile error here first, then every consumer.
 */
export const VERB_CAPABILITY: Readonly<Record<SimulatorVerb, SimulatorCapability>> = {
  list: 'list',
  boot: 'boot',
  shutdown: 'boot',
  create: 'create',
  listDeviceTypes: 'create',
  install: 'install',
  launch: 'launch',
  terminate: 'terminate',
  screenshot: 'screenshot',
  openUrl: 'openUrl',
  describe: 'describe',
  input: 'input',
  stream: 'stream',
}

/**
 * Impl-hook names each advertised capability must override, for the
 * advertisement↔override consistency helper (`do${Cap}${Extra}` conventions:
 * `'boot'` requires BOTH power directions; `'create'` requires device
 * creation AND its device-type listing).
 */
export const CAPABILITY_IMPL_HOOKS: Readonly<Record<SimulatorCapability, readonly string[]>> = {
  list: ['doList'],
  boot: ['doBoot', 'doShutdown'],
  create: ['doCreate', 'doListDeviceTypes'],
  install: ['doInstall'],
  launch: ['doLaunch'],
  terminate: ['doTerminate'],
  screenshot: ['doScreenshot'],
  openUrl: ['doOpenUrl'],
  describe: ['doDescribe'],
  input: ['doInput'],
  stream: ['doStreamStart'],
}
