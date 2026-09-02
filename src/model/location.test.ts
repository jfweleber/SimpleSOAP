import { describe, expect, it } from 'vitest'
import {
  describeLocation,
  emptyLocation,
  formatCoords,
  formatCoordsBoth,
  formatUTM,
  locationSummary,
} from './location'
import type { IncidentLocation } from './types'

function at(latitude: number, longitude: number, description = ''): IncidentLocation {
  return { ...emptyLocation(), description, latitude, longitude }
}

describe('UTM', () => {
  /*
   * Expected values come from Snyder's series cross-checked against the
   * Krüger n-series, which agree to under a millimetre at each of these.
   */
  it('converts a fix in the field', () => {
    // Arizona, the zone this team actually works in
    expect(formatUTM(at(34.0, -111.5))).toBe('12S 453826E 3762269N')
    expect(formatUTM(at(33.4, -112.1))).toBe('12S 397706E 3696173N')
  })

  it('handles both hemispheres', () => {
    expect(formatUTM(at(40.7128, -74.006))).toBe('18T 583959E 4507351N')
    // south of the equator the northing carries the 10 000 km false origin
    expect(formatUTM(at(-33.8688, 151.2093))).toBe('56H 334369E 6250948N')
  })

  it('keeps the zone irregularities the standard defines', () => {
    // south-west Norway widens zone 32
    expect(formatUTM(at(60, 5))).toMatch(/^32V /)
    // Svalbard skips 33 and 35 across
    expect(formatUTM(at(78, 15))).toMatch(/^33X /)
    expect(formatUTM(at(78, 25))).toMatch(/^35X /)
  })

  it('declines a position UTM does not cover', () => {
    expect(formatUTM(at(85, 0))).toBeNull()
    expect(formatUTM(at(-85, 0))).toBeNull()
    expect(formatUTM(emptyLocation())).toBeNull()
  })
})

describe('listing a location', () => {
  it('carries both grids, UTM first', () => {
    expect(formatCoordsBoth(at(34.0, -111.5))).toBe(
      '12S 453826E 3762269N (UTM) / 34.00000, -111.50000 (Decimal Degree)',
    )
  })

  it('says nothing when there is no fix', () => {
    expect(formatCoordsBoth(emptyLocation())).toBeNull()
    expect(formatCoords(emptyLocation())).toBeNull()
  })

  it('pairs the place name with both grids', () => {
    // the labels bring their own brackets, so the place name does not add more
    expect(describeLocation(at(34.0, -111.5, 'Trail junction 4'))).toBe(
      'Trail junction 4 — 12S 453826E 3762269N (UTM) / 34.00000, -111.50000 (Decimal Degree)',
    )
  })

  it('gives a collapsed header something that survives truncation', () => {
    // a place name beats coordinates; half a coordinate would be worse than none
    expect(locationSummary(at(34.0, -111.5, '911 E Sawmill'))).toBe('911 E Sawmill')
    expect(locationSummary(at(34.0, -111.5))).toBe('12S 453826E 3762269N')
    expect(locationSummary(emptyLocation())).toBe('')
  })
})
