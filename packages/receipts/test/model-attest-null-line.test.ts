/**
 * A transcript line that is valid JSON but not an object (2026-10-19). `null` parsed, and the reader then read `.message` of
 * null and threw a TypeError, so one stray line stopped the whole attestation with no words. A line that is not an object is
 * not a transcript entry: it is skipped, as a line that is not JSON already was, and every entry around it is read as before.
 */
import { describe, it, expect } from 'vitest'
import { attestModels, eventsFromClaudeCodeTranscript } from '../src/index.js'

const reply = (model: string, id: string, at: string): string =>
  JSON.stringify({ type: 'assistant', timestamp: at, message: { id, model, content: [{ type: 'text', text: 'ok' }] } })
const two = [reply('claude-opus-4-8', 'm1', '2026-10-19T10:00:00Z'), reply('claude-opus-4-8', 'm2', '2026-10-19T10:01:00Z')]

describe('a transcript line that is JSON but not an object', () => {
  it('a bare null line is skipped, never thrown on; the replies around it are read', () => {
    const t = [two[0], 'null', two[1]].join('\n')
    expect(() => eventsFromClaudeCodeTranscript(t)).not.toThrow()
    const events = eventsFromClaudeCodeTranscript(t)
    expect(events.map((e) => e.type)).toEqual(['reply', 'reply'])
    expect(events).toEqual(eventsFromClaudeCodeTranscript(two.join('\n')))
    expect(attestModels(events, { declared: 'claude-opus-4-8' }).outcome).toBe('PASS')
  })

  it('numbers, strings, booleans and arrays on a line are skipped the same way', () => {
    for (const odd of ['0', '"null"', 'true', 'false', '[]', '[{"type":"assistant","message":{"model":"x"}}]']) {
      const t = [two[0], odd, two[1]].join('\n')
      expect(eventsFromClaudeCodeTranscript(t), odd).toEqual(eventsFromClaudeCodeTranscript(two.join('\n')))
    }
  })
})
