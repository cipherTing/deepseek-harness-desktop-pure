/**
 * Acceptance coverage for the rescope codemod's exact-edit classifier,
 * including idempotency failures and the repository's intentional prose pairs.
 */

import { describe, expect, it } from 'vitest'
import { exactEditState } from './rescope-vendor.ts'

const ANCHOR = '\n## Sync procedure'
const INSERTED = `\n15. **rescope**: one log entry.\n${ANCHOR}`

describe('exactEditState', () => {
  it('classifies an insertion by its target form, so a duplicate is invalid', () => {
    expect(exactEditState(`log\n${ANCHOR}\n`, ANCHOR, INSERTED, 1)).toBe('pending')
    expect(exactEditState(`log${INSERTED}\n`, ANCHOR, INSERTED, 1)).toBe('applied')
    // The anchor survives an insertion, so counting the source form would have
    // called this pending and inserted the entry a second time.
    expect(exactEditState(`log${INSERTED}${INSERTED}\n`, ANCHOR, INSERTED, 1)).toBe('invalid')
    expect(exactEditState('log\n', ANCHOR, INSERTED, 1)).toBe('invalid')
  })

  it('classifies a deletion by its source form, and requires its remainder to survive', () => {
    const remainder = 'exclude:\n'
    const withEntries = 'exclude:\n  - cordis@4\n'
    expect(exactEditState(withEntries, withEntries, remainder, 1)).toBe('pending')
    expect(exactEditState(remainder, withEntries, remainder, 1)).toBe('applied')
    // Upstream dropped the whole field: the source form is gone, but so is the
    // remainder, so this is a moved site rather than a completed deletion.
    expect(exactEditState('unrelated:\n', withEntries, remainder, 1)).toBe('invalid')
  })

  it('requires a replacement to leave no source form and the exact target count', () => {
    expect(exactEditState('a = 1\n', 'a = 1', 'b = 2', 1)).toBe('pending')
    expect(exactEditState('b = 2\n', 'a = 1', 'b = 2', 1)).toBe('applied')
    expect(exactEditState('b = 2\nb = 2\n', 'a = 1', 'b = 2', 1)).toBe('invalid')
    // A moved or partially applied site: neither state is complete.
    expect(exactEditState('a = 1\nb = 2\n', 'a = 1', 'b = 2', 1)).toBe('invalid')
    expect(exactEditState('x\n', 'a = 1', 'b = 2', 1)).toBe('invalid')
  })

  it('accepts the current intentional prose replacements in both directions', () => {
    const pairs = [
      [
        '@cordisjs/plugin-timer                timer service (writes nothing to stdout)',
        '@deepseek-ai/cordis-plugin-timer      timer service (writes nothing to stdout)',
      ],
      [
        '  package.json     # from upstream; keep name/exports/type (publishable release member, no private flag)',
        '  package.json     # from upstream; rescope the name, keep exports/type (publishable release member, no private flag)',
      ],
      [
        "keep upstream's `name`/`exports`/`type`",
        "rescope the `name` ([mapping](../rescope.md)) while keeping upstream's `exports`/`type`",
      ],
      [
        '保留上游的 `name`/`exports`/`type`',
        '改写 `name` 的 scope（[映射](../rescope.zh.md)），保留上游的 `exports`/`type`',
      ],
    ] as const

    for (const [upstream, rescoped] of pairs) {
      expect(exactEditState(rescoped, upstream, rescoped, 1)).toBe('applied')
      expect(exactEditState(rescoped, rescoped, upstream, 1)).toBe('pending')
      expect(exactEditState(upstream, rescoped, upstream, 1)).toBe('applied')
    }
  })
})
