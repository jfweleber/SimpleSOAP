/**
 * The browser chooser's filter list.
 *
 * Web Bluetooth ORs the entries in `filters` and ANDs the fields inside each
 * one. The distinction is the whole bug: a name prefix folded into a service
 * entry admits only devices with both, and a BerryMed oximeter advertising its
 * name and not its UUID has one.
 */

import { describe, expect, it } from 'vitest'
import { chooserFilters } from './session'

describe('chooser filters', () => {
  it('gives every service and every name prefix its own entry', () => {
    const filters = chooserFilters(['0000180d-0000-1000-8000-00805f9b34fb'], ['BM', 'BerryMed'])
    expect(filters).toEqual([
      { services: ['0000180d-0000-1000-8000-00805f9b34fb'] },
      { namePrefix: 'BM' },
      { namePrefix: 'BerryMed' },
    ])
  })

  it('never puts a name prefix on a service entry', () => {
    for (const filter of chooserFilters(['a', 'b'], ['X'])) {
      expect('services' in filter && 'namePrefix' in filter).toBe(false)
    }
  })

  it('is empty when there is nothing to filter on', () => {
    expect(chooserFilters([], [])).toEqual([])
  })
})
