// Session ledger fold: mutating tool decoding, fragment extraction with
// confinement, and the entry shape the Changes tab consumes.
import { describe, expect, it } from 'vitest'
import { decodeMutatingCalls, extractFragment, foldSessionChanges } from '../src/sessionfold.ts'

function toolCall(seq: number, name: string, args: Record<string, unknown>): {
  type: 'tool/call'
  seq: number
  time: number
  data: { name: string; arguments: string }
} {
  return { type: 'tool/call', seq, time: 1_787_000_000_000 + seq, data: { name, arguments: JSON.stringify(args) } }
}

describe('decodeMutatingCalls', () => {
  it('keeps only mutation tools and skips malformed argument JSON', () => {
    const events = [
      toolCall(1, 'edit', { file_path: '/w/a.ts', old_string: 'x', new_string: 'y' }),
      toolCall(2, 'read', { file_path: '/w/a.ts' }),
      toolCall(3, 'write', { file_path: '/w/b.md', content: 'hi' }),
      { type: 'tool/call', seq: 4, time: 5, data: { name: 'write', arguments: '{broken' } },
      toolCall(5, 'EDIT', { file_path: '/w/a.ts', old_string: '1', new_string: '2' }),
    ]
    const calls = decodeMutatingCalls(events)
    expect(calls.map(call => [call.seq, call.toolRaw])).toEqual([
      [1, 'Edit'],
      [3, 'Write'],
      [5, 'Edit'],
    ])
  })
})

describe('extractFragment', () => {
  const root = '/Volumes/ws'

  it('maps edit old/new strings onto before/after', () => {
    const call = decodeMutatingCalls([toolCall(9, 'edit', {
      file_path: '/Volumes/ws/src/a.ts',
      old_string: 'old',
      new_string: 'new',
    })])[0]
    expect(extractFragment(call!, root)).toEqual({
      path: 'src/a.ts',
      before: 'old',
      after: 'new',
    })
  })

  it('handles str_replace_editor create/str_replace and refuses view commands', () => {
    const mk = (command: string, extra: Record<string, unknown>) =>
      decodeMutatingCalls([toolCall(11, 'str_replace_editor', {
        file_path: `${root}/doc.md`,
        command,
        ...extra,
      })])[0]!
    expect(extractFragment(mk('create', { new_str: '# Title' }), root)).toEqual({
      path: 'doc.md', before: null, after: '# Title',
    })
    expect(extractFragment(mk('str_replace', { old_str: 'a', new_str: 'b' }), root))
      .toEqual({ path: 'doc.md', before: 'a', after: 'b' })
    expect(extractFragment(mk('view', {}), root)).toBeUndefined()
  })

  it('drops calls whose file escapes the workspace root', () => {
    const call = decodeMutatingCalls([toolCall(13, 'write', {
      file_path: '/etc/passwd',
      content: 'nope',
    })])[0]
    expect(extractFragment(call!, root)).toBeUndefined()
  })
})

describe('foldSessionChanges', () => {
  it('produces ordered entries with fragment byte sizes and hunk counts', () => {
    const events = [
      toolCall(21, 'write', { file_path: '/w/newfile.md', content: 'alpha\n' }),
      toolCall(22, 'edit', { file_path: '/w/src/x.ts', old_string: 'one\ntwo\nthree\n', new_string: 'one\ndue\nthree\n' }),
    ]
    const entries = foldSessionChanges({ id: 'session-1' }, '/w', events)
    expect(entries.map(entry => entry.status)).toEqual(['A', 'M'])
    expect(entries[0]).toMatchObject({
      scope: 'session',
      sessionId: 'session-1',
      tool: 'Write',
      beforeBytes: null,
      afterBytes: 6,
      hunksCount: 1,
    })
    expect(entries[1]?.beforeBytes).toBe(14)
    expect(entries[1]?.afterBytes).toBe(14)
    expect(new Date(entries[0]!.at ?? '').toISOString()).toContain('T')
  })

  it('returns nothing for logs without mutating calls', () => {
    expect(foldSessionChanges({ id: 's' }, '/w', [
      { type: 'user/message', seq: 1, time: 2, data: {} },
    ])).toEqual([])
  })
})
