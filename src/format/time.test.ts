import { describe, expect, it } from 'vitest'
import { celsiusToFahrenheit, dateTimeText, hhmm } from './time'

describe('time formatting', () => {
  it('uses a 24-hour clock', () => {
    // 14:07 local
    const afternoon = new Date(2026, 7, 30, 14, 7).getTime()
    expect(hhmm(afternoon)).toBe('14:07')
  })

  it('renders midnight as 00, never 24', () => {
    const midnight = new Date(2026, 7, 30, 0, 10).getTime()
    expect(hhmm(midnight)).toBe('00:10')
  })

  it('shows a dash rather than a fake time when nothing was recorded', () => {
    expect(hhmm(null)).toBe('—')
    expect(dateTimeText(null)).toBe('—')
  })

  it('carries 24-hour time into the dated form', () => {
    expect(dateTimeText(new Date(2026, 7, 30, 21, 3).getTime())).toContain('21:03')
  })
})

describe('temperature conversion', () => {
  it('converts body temperatures correctly', () => {
    expect(celsiusToFahrenheit(37)).toBe(99)
    expect(celsiusToFahrenheit(36.7)).toBe(98)
    expect(celsiusToFahrenheit(0)).toBe(32)
  })

  it('handles hypothermic readings', () => {
    expect(celsiusToFahrenheit(32)).toBe(90)
  })
})
