// Secret masking policy: file-name withholding plus content-pattern redaction.
import { describe, expect, it } from 'vitest'
import { isSecretFile, maskFileContent, maskSecretText } from '../src/secrets.ts'

describe('isSecretFile', () => {
  it.each([
    ['.env'],
    ['.env.local'],
    ['deploy/.env.production'],
    ['server.pem'],
    ['id_rsa'],
    ['id_ed25519.pub'],
    ['secrets.json'],
    ['credentials.json'],
  ])('treats %j as pure secret material', (path) => {
    expect(isSecretFile(path)).toBe(true)
  })

  it.each([
    ['src/index.ts'],
    ['env.example.md'],
    ['keys.md'],
    ['package.json'],
  ])('leaves %j open', (path) => {
    expect(isSecretFile(path)).toBe(false)
  })
})

describe('maskSecretText', () => {
  it('collapses PEM blocks including their body', () => {
    const text = 'before\n-----BEGIN PRIVATE KEY-----\nabc\nxyz\n-----END PRIVATE KEY-----\nafter'
    const { masked, changed } = maskSecretText(text)
    expect(changed).toBe(true)
    expect(masked).toContain('***')
    expect(masked).not.toContain('abc')
  })

  it('masks provider token shapes but not ordinary words', () => {
    const { masked } = maskSecretText('token sk-abcdefABCDEF1234567890 here\nplain text')
    expect(masked).not.toContain('sk-abcdef')
    expect(masked).toContain('plain text')
  })

  it('keeps KEY=value left sides so readers see which variable existed', () => {
    const { masked } = maskSecretText('DEPLOY_API_KEY=hunter2secret\nOTHER=x')
    expect(masked).toContain('DEPLOY_API_KEY=')
    expect(masked).not.toContain('hunter2')
  })
})

describe('maskFileContent', () => {
  it('replaces whole secrets-file content with one notice', () => {
    const { masked, changed } = maskFileContent('.env', 'PASSWORD=nope\nPASSWORD2=nope2')
    expect(changed).toBe(true)
    expect(masked).not.toContain('nope')
    expect(masked.toLowerCase()).toContain('withheld')
  })

  it('passes harmless content untouched', () => {
    const source = 'export const answer = 42\n'
    expect(maskFileContent('src/answer.ts', source)).toEqual({ masked: source, changed: false })
  })
})
