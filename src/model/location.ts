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

/** Degrees and decimal minutes — how coordinates are read aloud on the radio. */
export function formatCoordsSpoken(l: IncidentLocation): string | null {
  if (l.latitude === null || l.longitude === null) return null
  const part = (value: number, positive: string, negative: string) => {
    const hemisphere = value >= 0 ? positive : negative
    const abs = Math.abs(value)
    const degrees = Math.floor(abs)
    const minutes = (abs - degrees) * 60
    return `${hemisphere} ${degrees}° ${minutes.toFixed(3)}'`
  }
  return `${part(l.latitude, 'N', 'S')}, ${part(l.longitude, 'E', 'W')}`
}

export function describeLocation(l: IncidentLocation): string {
  const coords = formatCoords(l)
  if (l.description.trim() && coords) return `${l.description.trim()} (${coords})`
  if (l.description.trim()) return l.description.trim()
  return coords ?? ''
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
