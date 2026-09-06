declare module '*.module.css' {
  /** CSS Modules hash-map export compiled by the build pipeline. */
  const classes: Readonly<Record<string, string>>
  export default classes
}
