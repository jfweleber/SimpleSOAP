import { describe, expect, it } from 'vitest'
import { newComplaint } from './factory'

describe('complaint seeding', () => {
  it('carries the chief complaint into the first one', () => {
    expect(newComplaint('Right wrist pain after a fall').what).toBe('Right wrist pain after a fall')
  })

  it('defaults to blank, so a second complaint starts empty', () => {
    expect(newComplaint().what).toBe('')
  })

  it('gives every complaint its own id', () => {
    expect(newComplaint('a').id).not.toBe(newComplaint('a').id)
  })
})
