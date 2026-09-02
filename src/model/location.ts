import { Geolocation } from '@capacitor/geolocation'
import type { IncidentLocation } from './types'
import { isNative } from '../platform'

/**
 * Where the incident is.
 *
 * Both halves matter. Coordinates are what a helicopter needs; a place name is
 * what dispatch actually recognises, and on a callout in familiar terrain that
 * is often faster and less error-prone than reading out digits. Neither
 * replaces the other, so both are kept.
 */

export function emptyLocation(): IncidentLocation {
  return { description: '', latitude: null, longitude: null, accuracyM: null, fixedAt: null }
}

/** Decimal degrees, the format most dispatch systems and mapping apps take. */
export function formatCoords(l: IncidentLocation): string | null {
  if (l.latitude === null || l.longitude === null) return null
  return `${l.latitude.toFixed(5)}, ${l.longitude.toFixed(5)}`
}

/**
 * UTM, WGS84.
 *
 * The grid the team runs on. Air assets and the state DPS work in decimal
 * degrees, so both formats are carried side by side and the responder reads
 * whichever the party on the other end of the radio uses.
 *
 * Snyder's series, which is good to a centimetre inside a zone — far past
 * anything a handheld fix is worth. Cross-checked against the Krüger n-series.
 */
export function formatUTM(l: IncidentLocation): string | null {
  if (l.latitude === null || l.longitude === null) return null
  const { latitude: lat, longitude: lon } = l
  // UTM is undefined at the poles; nothing else here would be right either
  if (lat < -80 || lat > 84) return null

  const zone = utmZone(lat, lon)
  const a = 6378137
  const f = 1 / 298.257223563
  const k0 = 0.9996
  const e2 = f * (2 - f)
  const ep2 = e2 / (1 - e2)

  const rad = Math.PI / 180
  const phi = lat * rad
  const lambda0 = ((zone - 1) * 6 - 180 + 3) * rad

  const N = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2)
  const T = Math.tan(phi) ** 2
  const C = ep2 * Math.cos(phi) ** 2
  const A = Math.cos(phi) * (lon * rad - lambda0)
  const M =
    a *
    ((1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256) * phi -
      ((3 * e2) / 8 + (3 * e2 ** 2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * phi) +
      ((15 * e2 ** 2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * phi) -
      ((35 * e2 ** 3) / 3072) * Math.sin(6 * phi))

  const easting =
    k0 *
      N *
      (A +
        ((1 - T + C) * A ** 3) / 6 +
        ((5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5) / 120) +
    500000
  let northing =
    k0 *
    (M +
      N *
        Math.tan(phi) *
        ((A * A) / 2 +
          ((5 - T + 9 * C + 4 * C * C) * A ** 4) / 24 +
          ((61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6) / 720))
  if (lat < 0) northing += 10000000

  const e = String(Math.round(easting)).padStart(6, '0')
  const n = String(Math.round(northing)).padStart(7, '0')
  return `${zone}${latitudeBand(lat)} ${e}E ${n}N`
}

/** Zone number, including the two irregularities the standard carries. */
function utmZone(lat: number, lon: number): number {
  if (lat >= 56 && lat < 64 && lon >= 3 && lon < 12) return 32 // south-west Norway
  if (lat >= 72 && lat < 84) {
    // Svalbard
    if (lon >= 0 && lon < 9) return 31
    if (lon >= 9 && lon < 21) return 33
    if (lon >= 21 && lon < 33) return 35
    if (lon >= 33 && lon < 42) return 37
  }
  return Math.floor((lon + 180) / 6) + 1
}

/** The letter after the zone number: 8° of latitude each, X taking 12. */
function latitudeBand(lat: number): string {
  const bands = 'CDEFGHJKLMNPQRSTUVWX'
  return bands[Math.min(bands.length - 1, Math.floor((lat + 80) / 8))]
}

/**
 * Both grids on one line, each named.
 *
 * Nobody converts under stress: whoever is on the radio reads the half their
 * counterpart works in and ignores the other. The labels are there so picking
 * the wrong half takes a deliberate mistake rather than a glance.
 */
export function formatCoordsBoth(l: IncidentLocation): string | null {
  const decimal = formatCoords(l)
  if (!decimal) return null
  const utm = formatUTM(l)
  return utm ? `${utm} (UTM) / ${decimal} (Decimal Degree)` : `${decimal} (Decimal Degree)`
}

export function describeLocation(l: IncidentLocation): string {
  const coords = formatCoordsBoth(l)
  if (l.description.trim() && coords) return `${l.description.trim()} — ${coords}`
  if (l.description.trim()) return l.description.trim()
  return coords ?? ''
}

/**
 * The shortest honest answer, for a collapsed section header.
 *
 * The full listing is two grids long and would be cut mid-coordinate, and half
 * a coordinate on a patient record is worse than none.
 */
export function locationSummary(l: IncidentLocation): string {
  return l.description.trim() || formatUTM(l) || formatCoords(l) || ''
}

export class LocationError extends Error {}

/**
 * Take a GPS fix.
 *
 * High accuracy is requested and the timeout is generous — under canopy or in
 * a drainage a usable fix can take a while, and a slow correct position beats
 * a fast wrong one.
 */
export async function currentPosition(): Promise<Partial<IncidentLocation>> {
  try {
    /*
     * The permission dance is native-only.
     *
     * On the web there is no separate request step — the browser prompts when
     * the position is actually asked for, and the plugin's requestPermissions
     * is a stub that throws. Calling it here was the bug: checkPermissions
     * reports "prompt", which is not "granted", so the stub always ran.
     */
    if (isNative()) {
      const permission = await Geolocation.checkPermissions()
      if (permission.location !== 'granted' && permission.coarseLocation !== 'granted') {
        const asked = await Geolocation.requestPermissions()
        if (asked.location !== 'granted' && asked.coarseLocation !== 'granted') {
          throw new LocationError('Location permission was declined.')
        }
      }
    }

    const position = await Geolocation.getCurrentPosition({
      enableHighAccuracy: true,
      timeout: 30_000,
      maximumAge: 0,
    })

    return {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracyM: position.coords.accuracy ?? null,
      fixedAt: position.timestamp,
    }
  } catch (error) {
    if (error instanceof LocationError) throw error
    throw new LocationError(explain(error))
  }
}

/** Turn a positioning failure into something worth reading. */
function explain(error: unknown): string {
  // browsers report a numeric code; the message is usually useless
  const code = (error as { code?: number } | null)?.code
  if (code === 1) {
    return 'Location permission was denied. Allow it for this site in your browser settings, then try again.'
  }
  if (code === 2) {
    return 'No position available. Move somewhere with a clearer view of the sky, or type the location instead.'
  }
  if (code === 3) {
    return 'No GPS fix within 30 seconds. Try again outdoors, or type the location instead.'
  }

  const message = error instanceof Error ? error.message : String(error)
  if (/timeout/i.test(message)) {
    return 'No GPS fix within 30 seconds. Try again outdoors, or type the location instead.'
  }
  if (/secure|https/i.test(message)) {
    return 'Location needs a secure connection. Open this app over https.'
  }
  return message
}
