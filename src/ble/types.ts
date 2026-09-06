/**
 * Telemetry types for BLE vitals monitors.
 *
 * A Measurement is the normalized shape every adapter produces, regardless of
 * whether the device speaks a standard GATT profile or a vendor protocol.
 */

export interface Measurement {
  /** ms since epoch, stamped on receipt */
  timestamp: number
  /** beats per minute */
  heartRate: number | null
  /** oxygen saturation, percent */
  spo2: number | null
  /** perfusion index, percent — signal strength; low values mean a poor trace */
  perfusionIndex: number | null
  /** breaths per minute, only a few devices derive this */
  respiratoryRate: number | null
  /** beat-to-beat intervals in ms, for HRV. Empty when unsupported. */
  rrIntervals: number[]
  /** true/false when the device reports it, null when it has no opinion */
  sensorContact: boolean | null
}

export function emptyMeasurement(): Measurement {
  return {
    timestamp: Date.now(),
    heartRate: null,
    spo2: null,
    perfusionIndex: null,
    respiratoryRate: null,
    rrIntervals: [],
    sensorContact: null,
  }
}

/** What a scan turns up, before we know what it is. */
export interface ScannedDevice {
  deviceId: string
  name?: string
  serviceUUIDs?: string[]
  rssi?: number
}

/** Where to subscribe for notifications on a connected device. */
export interface NotifyTarget {
  service: string
  characteristic: string
}

/**
 * Extra subscriptions some devices need before they start streaming.
 * ChoiceMMed is the only one in the registry that does.
 */
export interface ExtraSubscription {
  service: string
  characteristic: string
}

export type AdapterKind = 'heartRate' | 'pulseOximeter'

export interface Adapter {
  /** stable id — persisted in vitals_recording.source */
  id: string
  /** shown in the device list */
  name: string
  kind: AdapterKind
  /** what a spec-compliant device of this type reports */
  provides: Array<'heartRate' | 'spo2' | 'perfusionIndex' | 'respiratoryRate' | 'rrIntervals'>
  /** service UUIDs to filter the scan on */
  scanServiceUUIDs: string[]
  /** true when this adapter can drive the scanned device */
  matches(device: ScannedDevice): boolean
  /** which characteristic carries the stream */
  target(device: ScannedDevice): NotifyTarget
  /** subscriptions to open first, if any */
  extraSubscriptions?(device: ScannedDevice): ExtraSubscription[]
  /** decode one notification. null means "not a frame we recognize" — drop it. */
  parse(view: DataView): Measurement | null
  /**
   * True when this adapter has been verified against real hardware.
   * Everything derived from protocol analysis alone starts false.
   */
  verified: boolean
}
