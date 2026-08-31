/**
 * Diagnostics for devices that connect but never deliver a reading.
 *
 * A silent subscription has several possible causes — the characteristic is
 * not the one carrying data, the device only streams while some mode is
 * active on the device itself, or notifications were never actually enabled.
 * Guessing between them from the outside is slow, so this module reports what
 * the device actually exposes and, when asked, listens to everything at once
 * to find where data is really coming from.
 */

import { BleClient } from '@capacitor-community/bluetooth-le'
import { normalize } from './uuid'

export interface CharacteristicInfo {
  uuid: string
  /** the property names the device claims, e.g. ['read', 'notify'] */
  properties: string[]
  canNotify: boolean
  canRead: boolean
}

export interface ServiceInfo {
  uuid: string
  /** friendly name when it is a known assigned number */
  label: string | null
  characteristics: CharacteristicInfo[]
}

const KNOWN_SERVICES: Record<string, string> = {
  '1800': 'Generic Access',
  '1801': 'Generic Attribute',
  '1808': 'Glucose',
  '1809': 'Health Thermometer',
  '180a': 'Device Information',
  '180d': 'Heart Rate',
  '180f': 'Battery',
  '1810': 'Blood Pressure',
  '1816': 'Cycling Speed and Cadence',
  '1818': 'Cycling Power',
  '181c': 'User Data',
  '1822': 'Pulse Oximeter',
  '1826': 'Fitness Machine',
}

/** 0000XXXX-0000-1000-8000-00805f9b34fb -> XXXX, else null */
export function shortUuid(uuid: string): string | null {
  const m = /^0000([0-9a-f]{4})-0000-1000-8000-00805f9b34fb$/.exec(uuid.toLowerCase())
  return m ? m[1] : null
}

export function labelFor(uuid: string): string | null {
  const short = shortUuid(uuid)
  return short ? (KNOWN_SERVICES[short] ?? null) : null
}

function propertyNames(p: Record<string, unknown>): string[] {
  return Object.entries(p)
    .filter(([, enabled]) => enabled === true)
    .map(([name]) => name)
}

/**
 * Force a fresh service discovery and report the whole GATT tree.
 *
 * `discoverServices` is called explicitly rather than relying on connect —
 * subscribing before discovery has completed fails silently on Android, which
 * looks exactly like a device that is not sending anything.
 */
export async function describe(deviceId: string): Promise<ServiceInfo[]> {
  await BleClient.discoverServices(deviceId).catch(() => {})
  const services = await BleClient.getServices(deviceId)
  return services.map((service) => ({
    uuid: normalize(service.uuid),
    label: labelFor(normalize(service.uuid)),
    characteristics: service.characteristics.map((c) => {
      const properties = propertyNames(c.properties as unknown as Record<string, unknown>)
      return {
        uuid: normalize(c.uuid),
        properties,
        canNotify: properties.includes('notify') || properties.includes('indicate'),
        canRead: properties.includes('read'),
      }
    }),
  }))
}

export interface Frame {
  at: number
  service: string
  characteristic: string
  /** raw bytes as hex, space separated */
  hex: string
  length: number
}

function toHex(view: DataView): string {
  const out: string[] = []
  for (let i = 0; i < view.byteLength; i++) {
    out.push(view.getUint8(i).toString(16).padStart(2, '0'))
  }
  return out.join(' ')
}

export interface Listener {
  /** how many characteristics were successfully subscribed */
  subscribed: number
  /** characteristics that refused a subscription, with the reason */
  failed: Array<{ characteristic: string; reason: string }>
  stop(): Promise<void>
}

/**
 * Subscribe to every characteristic that claims notify or indicate.
 *
 * This is the fastest way to find where a device actually publishes. Some
 * devices carry the standard service in their table but stream on a vendor
 * characteristic instead, and listening to everything at once answers that in
 * one connection rather than a dozen.
 */
export async function listenToEverything(
  deviceId: string,
  services: ServiceInfo[],
  onFrame: (frame: Frame) => void,
): Promise<Listener> {
  const opened: Array<{ service: string; characteristic: string }> = []
  const failed: Array<{ characteristic: string; reason: string }> = []

  for (const service of services) {
    // the generic profile services never carry telemetry, and subscribing to
    // Generic Attribute can drop the connection on some stacks
    const short = shortUuid(service.uuid)
    if (short === '1800' || short === '1801') continue

    for (const characteristic of service.characteristics) {
      if (!characteristic.canNotify) continue
      try {
        await BleClient.startNotifications(
          deviceId,
          service.uuid,
          characteristic.uuid,
          (view) => {
            onFrame({
              at: Date.now(),
              service: service.uuid,
              characteristic: characteristic.uuid,
              hex: toHex(view),
              length: view.byteLength,
            })
          },
        )
        opened.push({ service: service.uuid, characteristic: characteristic.uuid })
        // Android runs one GATT operation at a time and silently drops the
        // rest, so enabling ten subscriptions back to back can leave most of
        // them dead. Pace them.
        await new Promise((resolve) => setTimeout(resolve, 250))
      } catch (e) {
        failed.push({
          characteristic: characteristic.uuid,
          reason: e instanceof Error ? e.message : String(e),
        })
      }
    }
  }

  return {
    subscribed: opened.length,
    failed,
    async stop() {
      for (const target of opened) {
        await BleClient.stopNotifications(deviceId, target.service, target.characteristic).catch(
          () => {},
        )
      }
    },
  }
}

/** One-shot read, for characteristics that expose data without notifying. */
export async function readOnce(
  deviceId: string,
  service: string,
  characteristic: string,
): Promise<Frame> {
  const view = await BleClient.read(deviceId, service, characteristic)
  return {
    at: Date.now(),
    service,
    characteristic,
    hex: toHex(view),
    length: view.byteLength,
  }
}
