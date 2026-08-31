/**
 * Adapter registry for BLE vitals monitors.
 *
 * Two adapters implement published Bluetooth SIG profiles. The other five
 * implement vendor framing carried over a serial-style characteristic, derived
 * from protocol analysis; each is marked `verified: false` until it has been
 * confirmed against real hardware.
 *
 * Adding a device means adding one entry here. Nothing else needs to change.
 */

import type { Adapter, Measurement, ScannedDevice } from './types'
import { emptyMeasurement } from './types'
import {
  CHOICEMMED_ADVERT,
  FFE0_NOTIFY,
  FFE0_SERVICE,
  FFF0_NOTIFY,
  FFF0_SERVICE,
  HEART_RATE_MEASUREMENT,
  HEART_RATE_SERVICE,
  ISSC_NOTIFY,
  ISSC_SERVICE,
  JUMPER_NOTIFY,
  JUMPER_SERVICE,
  NUS_NOTIFY,
  NUS_SERVICE,
  PLX_CONTINUOUS_MEASUREMENT,
  PLX_SERVICE,
  VIATOM_NOTIFY,
  VIATOM_SERVICE,
} from './uuid'

const advertises = (d: ScannedDevice, uuid: string) => d.serviceUUIDs?.includes(uuid) ?? false
const namedLike = (d: ScannedDevice, patterns: RegExp[]) =>
  !!d.name && patterns.some((p) => p.test(d.name as string))

/** A reading where the probe is on but sees nothing — distinct from a bad frame. */
function noContact(): Measurement {
  return { ...emptyMeasurement(), sensorContact: false }
}

// ---------------------------------------------------------------------------
// Standard GATT — Heart Rate Service 0x180D
// ---------------------------------------------------------------------------

/**
 * Heart Rate Measurement, characteristic 0x2A37.
 *
 * Flags byte drives a variable layout:
 *   bit 0  heart rate is uint16 (else uint8)
 *   bit 1  sensor contact detected
 *   bit 2  sensor contact supported — bit 1 is meaningless without this
 *   bit 3  energy expended field present (uint16)
 *   bit 4  RR interval fields present (uint16 each, units of 1/1024 s)
 */
export const heartRateAdapter: Adapter = {
  id: 'ble_hr',
  name: 'Heart Rate Monitor',
  kind: 'heartRate',
  provides: ['heartRate', 'rrIntervals'],
  scanServiceUUIDs: [HEART_RATE_SERVICE],
  verified: false,
  matches: (d) => advertises(d, HEART_RATE_SERVICE),
  target: () => ({ service: HEART_RATE_SERVICE, characteristic: HEART_RATE_MEASUREMENT }),
  parse(view) {
    if (view.byteLength < 2) return null
    const flags = view.getUint8(0)
    const wide = (flags & 0x01) !== 0
    const contactSupported = (flags & 0x04) !== 0
    const contactDetected = (flags & 0x02) !== 0
    const hasEnergy = (flags & 0x08) !== 0
    const hasRR = (flags & 0x10) !== 0

    let offset = 1
    let heartRate: number
    if (wide) {
      if (view.byteLength < offset + 2) return null
      heartRate = view.getUint16(offset, true)
      offset += 2
    } else {
      heartRate = view.getUint8(offset)
      offset += 1
    }

    if (hasEnergy) offset += 2

    const rrIntervals: number[] = []
    if (hasRR) {
      while (offset + 1 < view.byteLength) {
        // transmitted in 1/1024 s units
        rrIntervals.push((view.getUint16(offset, true) / 1024) * 1000)
        offset += 2
      }
    }

    return {
      ...emptyMeasurement(),
      heartRate,
      rrIntervals,
      sensorContact: contactSupported ? contactDetected : null,
    }
  },
}

// ---------------------------------------------------------------------------
// Standard GATT — Pulse Oximeter Service 0x1822
// ---------------------------------------------------------------------------

/**
 * Decode an IEEE-11073 16-bit SFLOAT.
 *
 * Layout is a signed 4-bit exponent in the high nibble over a signed 12-bit
 * mantissa. Five mantissa values are reserved for non-numeric states
 * (+INFINITY, NaN, NRes, reserved, -INFINITY) and mean "no usable reading".
 */
function decodeSFloat(raw: number): number | null {
  const mantissa = raw & 0x0fff
  if (mantissa >= 0x07fe && mantissa <= 0x0802) return null

  const rawExponent = (raw >> 12) & 0x0f
  const exponent = rawExponent >= 0x08 ? rawExponent - 0x10 : rawExponent
  const value = mantissa >= 0x0800 ? mantissa - 0x1000 : mantissa
  return value * Math.pow(10, exponent)
}

/** PLX Continuous Measurement, characteristic 0x2A5F. */
export const plxAdapter: Adapter = {
  id: 'ble_plx',
  name: 'Pulse Oximeter (standard)',
  kind: 'pulseOximeter',
  provides: ['spo2', 'heartRate'],
  scanServiceUUIDs: [PLX_SERVICE],
  verified: false,
  matches: (d) => advertises(d, PLX_SERVICE),
  target: () => ({ service: PLX_SERVICE, characteristic: PLX_CONTINUOUS_MEASUREMENT }),
  parse(view) {
    // flags @0, then SpO2 and pulse rate as consecutive SFLOATs
    if (view.byteLength < 5) return null
    const spo2 = decodeSFloat(view.getUint16(1, true))
    const pulse = decodeSFloat(view.getUint16(3, true))
    if (spo2 === null || pulse === null) return noContact()
    return { ...emptyMeasurement(), spo2, heartRate: pulse, sensorContact: true }
  },
}

// ---------------------------------------------------------------------------
// Vendor — BCI protocol over Microchip/ISSC transparent UART (BerryMed)
// ---------------------------------------------------------------------------

const BERRYMED_NAMES = [/^BerryMed/i, /^BM\d/i]

export const berryMedAdapter: Adapter = {
  id: 'ble_bci',
  name: 'BerryMed / BCI',
  kind: 'pulseOximeter',
  provides: ['spo2', 'heartRate'],
  scanServiceUUIDs: [ISSC_SERVICE],
  verified: false,
  matches: (d) => advertises(d, ISSC_SERVICE) || namedLike(d, BERRYMED_NAMES),
  target: () => ({ service: ISSC_SERVICE, characteristic: ISSC_NOTIFY }),
  parse(view) {
    // 5-byte frame: pulse @3, SpO2 @4. A zero in either means no finger.
    if (view.byteLength < 5) return null
    const pulse = view.getUint8(3)
    const spo2 = view.getUint8(4)
    if (pulse === 0 || spo2 === 0) return noContact()
    return { ...emptyMeasurement(), heartRate: pulse, spo2, sensorContact: true }
  },
}

// ---------------------------------------------------------------------------
// Vendor — ChoiceMMed, over Nordic UART
// ---------------------------------------------------------------------------

const CHOICEMMED_NAMES = [/^iP\d+/i]

export const choiceMMedAdapter: Adapter = {
  id: 'ble_choicemmed',
  name: 'ChoiceMMed',
  kind: 'pulseOximeter',
  provides: ['spo2', 'heartRate', 'respiratoryRate', 'perfusionIndex'],
  scanServiceUUIDs: [NUS_SERVICE],
  verified: false,
  matches: (d) => advertises(d, CHOICEMMED_ADVERT) || namedLike(d, CHOICEMMED_NAMES),
  target: () => ({ service: NUS_SERVICE, characteristic: FFF0_NOTIFY }),
  // will not start streaming until this second characteristic is also subscribed
  extraSubscriptions: () => [{ service: NUS_SERVICE, characteristic: FFF0_SERVICE }],
  parse(view) {
    // 13-byte frame, 0x3E leader and 0xF0 terminator
    if (view.byteLength !== 13) return null
    if (view.getUint8(0) !== 0x3e) return null

    if (view.getUint8(12) !== 0xf0) {
      // idle frame the device sends with the probe empty
      const idle = view.getUint8(8) === 0x20 && view.getUint8(1) === 0 && view.getUint8(3) === 0
      return idle ? noContact() : null
    }

    const spo2 = view.getUint8(1)
    const pulse = view.getUint8(3)
    if (spo2 === 0 || pulse === 0) return noContact()

    const pi = view.getUint8(11)
    return {
      ...emptyMeasurement(),
      spo2,
      heartRate: pulse,
      respiratoryRate: view.getUint8(5),
      perfusionIndex: pi > 0 ? pi / 10 : null,
      sensorContact: true,
    }
  },
}

// ---------------------------------------------------------------------------
// Vendor — generic FFE0 serial bridge (HM-10 class modules)
// ---------------------------------------------------------------------------

const FFE0_NAMES = [/^HealthTree/i, /^OXIMETER/i]

export const ffe0Adapter: Adapter = {
  id: 'ble_ffe0',
  name: 'Generic Oximeter (FFE0)',
  kind: 'pulseOximeter',
  provides: ['spo2', 'heartRate', 'perfusionIndex'],
  scanServiceUUIDs: [FFE0_SERVICE],
  verified: false,
  matches: (d) => advertises(d, FFE0_SERVICE) || namedLike(d, FFE0_NAMES),
  target: () => ({ service: FFE0_SERVICE, characteristic: FFE0_NOTIFY }),
  parse(view) {
    // 20-byte frame behind an 0xFF 0x44 signature
    if (view.byteLength !== 20) return null
    if (view.getUint8(0) !== 0xff || view.getUint8(1) !== 0x44) return null

    const spo2 = view.getUint8(4)
    const pulse = view.getUint8(5)
    // 0xFF is the no-data sentinel; anything over 100% is a bad frame
    if (spo2 === 0 || spo2 === 0xff || pulse === 0 || pulse === 0xff || spo2 > 100) {
      return noContact()
    }

    // perfusion index spans two bytes, 7 significant bits each
    const pi = (view.getUint8(6) & 0x7f) | ((view.getUint8(7) & 0x7f) << 7)
    return {
      ...emptyMeasurement(),
      spo2,
      heartRate: pulse,
      perfusionIndex: pi > 0 ? pi / 100 : null,
      sensorContact: true,
    }
  },
}

// ---------------------------------------------------------------------------
// Vendor — Jumper
// ---------------------------------------------------------------------------

export const jumperAdapter: Adapter = {
  id: 'ble_jumper',
  name: 'Jumper',
  kind: 'pulseOximeter',
  provides: ['spo2', 'heartRate', 'perfusionIndex'],
  scanServiceUUIDs: [JUMPER_SERVICE],
  verified: false,
  matches: (d) => advertises(d, JUMPER_SERVICE),
  target: () => ({ service: JUMPER_SERVICE, characteristic: JUMPER_NOTIFY }),
  parse(view) {
    // 4-byte frame behind an 0x81 leader
    if (view.byteLength < 4) return null
    if (view.getUint8(0) !== 0x81) return null

    const pulse = view.getUint8(1)
    const spo2 = view.getUint8(2)
    if (pulse === 0 || spo2 === 0) return noContact()

    const pi = view.getUint8(3)
    return {
      ...emptyMeasurement(),
      heartRate: pulse,
      spo2,
      perfusionIndex: pi > 0 ? pi / 10 : null,
      sensorContact: true,
    }
  },
}

// ---------------------------------------------------------------------------
// Vendor — Viatom / Wellue
// ---------------------------------------------------------------------------

/**
 * CRC-8, polynomial 0x8C (reflected 0x31), zero seed.
 * Covers every byte of the frame except the checksum itself.
 */
function crc8(bytes: Uint8Array, length: number): number {
  let crc = 0
  for (let i = 0; i < length; i++) {
    crc ^= bytes[i]
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x01 ? (crc >> 1) ^ 0x8c : crc >> 1
    }
  }
  return crc
}

export const viatomAdapter: Adapter = {
  id: 'ble_viatom',
  name: 'Viatom / Wellue',
  kind: 'pulseOximeter',
  provides: ['spo2', 'heartRate'],
  scanServiceUUIDs: [VIATOM_SERVICE, NUS_SERVICE],
  verified: false,
  matches: (d) => advertises(d, VIATOM_SERVICE) || advertises(d, NUS_SERVICE),
  // newer units use the Viatom service; older ones fall back to Nordic UART
  target: (d) =>
    advertises(d, VIATOM_SERVICE)
      ? { service: VIATOM_SERVICE, characteristic: VIATOM_NOTIFY }
      : { service: NUS_SERVICE, characteristic: NUS_NOTIFY },
  parse(view) {
    // 0xAA 0x55 leader, uint16 length @3, CRC-8 in the final byte
    if (view.byteLength < 8) return null
    if (view.getUint8(0) !== 0xaa || view.getUint8(1) !== 0x55) return null

    const frameLength = 5 + view.getUint16(3, true)
    if (view.byteLength < frameLength) return null

    const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
    if (crc8(bytes, frameLength - 1) !== view.getUint8(frameLength - 1)) return null

    // packet type 1 is the vitals frame; others are battery, config, etc.
    if (view.getUint8(5) !== 0x01) return null

    const spo2 = view.getUint8(6)
    const pulse = view.getUint8(7)
    if (spo2 === 0 || pulse === 0) return noContact()
    return { ...emptyMeasurement(), spo2, heartRate: pulse, sensorContact: true }
  },
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * Order matters. Standard profiles are tried first so a spec-compliant device
 * is never claimed by a vendor adapter with a looser match — Viatom in
 * particular matches on bare Nordic UART, which many unrelated devices expose.
 */
export const adapters: Adapter[] = [
  heartRateAdapter,
  plxAdapter,
  berryMedAdapter,
  jumperAdapter,
  ffe0Adapter,
  choiceMMedAdapter,
  viatomAdapter,
]

/** Every service UUID worth scanning for, deduplicated. */
export function scanServiceUUIDs(): string[] {
  return [...new Set(adapters.flatMap((a) => a.scanServiceUUIDs))]
}

/** First adapter that claims the device, or null if nothing recognizes it. */
export function resolveAdapter(device: ScannedDevice): Adapter | null {
  return adapters.find((a) => a.matches(device)) ?? null
}

export function adapterById(id: string): Adapter | null {
  return adapters.find((a) => a.id === id) ?? null
}
