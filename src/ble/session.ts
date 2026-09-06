/**
 * BLE scanning and connection, on top of @capacitor-community/bluetooth-le.
 *
 * Two scan modes. The filtered scan asks the OS for devices advertising a
 * service we support, which in a populated area is the difference between a
 * three-line list and a hundred-line one. The unfiltered scan takes every
 * advertisement and is for working out why a device is not showing up.
 */

/// <reference types="web-bluetooth" />
// ^ ships with @capacitor-community/bluetooth-le; only chooseDevice needs it

import { BleClient, type ScanResult } from '@capacitor-community/bluetooth-le'
import type { Adapter, Measurement, ScannedDevice } from './types'
import { resolveAdapter, scanNamePrefixes, scanServiceUUIDs } from './adapters'
import { normalize } from './uuid'

export interface Discovered {
  device: ScannedDevice
  adapter: Adapter | null
  rssi: number
  firstSeen: number
  lastSeen: number
}

function toScannedDevice(result: ScanResult): ScannedDevice {
  return {
    deviceId: result.device.deviceId,
    name: result.device.name ?? result.localName ?? undefined,
    // platforms report UUIDs in mixed forms; normalize before matching
    serviceUUIDs: (result.uuids ?? []).map(normalize),
    rssi: result.rssi ?? undefined,
  }
}

export async function initialize(): Promise<void> {
  await BleClient.initialize({ androidNeverForLocation: false })
}

export async function isEnabled(): Promise<boolean> {
  try {
    return await BleClient.isEnabled()
  } catch {
    return false
  }
}

export type ScanMode = 'compatible' | 'all'
export type ScanHandler = (result: ScanResult, adapter: Adapter | null) => void

/**
 * Start scanning.
 *
 * In 'compatible' mode the service filter is applied by the OS, so devices
 * that do not advertise a supported service never reach us at all. Note that
 * some devices carry a service in their GATT table without advertising it —
 * those need 'all' mode plus `inspect` to find.
 */
export async function startScan(mode: ScanMode, onFound: ScanHandler): Promise<void> {
  await BleClient.requestLEScan(
    {
      services: mode === 'compatible' ? scanServiceUUIDs() : undefined,
      allowDuplicates: true,
    },
    (result) => onFound(result, resolveAdapter(toScannedDevice(result))),
  )
}

export { toScannedDevice }

export async function stopScan(): Promise<void> {
  try {
    await BleClient.stopLEScan()
  } catch {
    // already stopped — not worth surfacing
  }
}

export interface Connection {
  deviceId: string
  adapter: Adapter
  /**
   * Tear down and re-open the subscription without dropping the link.
   *
   * Some devices only begin publishing once a mode is started on the device
   * itself, and a subscription opened before that can stay dead. Re-arming is
   * far quicker than a full reconnect and keeps any bonding in place.
   */
  resubscribe(): Promise<void>
  disconnect(): Promise<void>
}

export interface ConnectHandlers {
  onMeasurement: (m: Measurement) => void
  /** every frame that arrives, decoded or not — for diagnostics */
  onFrame?: (hex: string, parsed: boolean) => void
  onDisconnect?: (deviceId: string) => void
}

function toHex(view: DataView): string {
  const out: string[] = []
  for (let i = 0; i < view.byteLength; i++) out.push(view.getUint8(i).toString(16).padStart(2, '0'))
  return out.join(' ')
}

/**
 * Connect and subscribe to the adapter's measurement characteristic.
 *
 * Service discovery is forced before subscribing. Android will accept a
 * subscription against a characteristic it has not discovered and then simply
 * never deliver anything, which is indistinguishable from a silent device.
 *
 * Frames the adapter does not recognize are still reported to `onFrame` but
 * not turned into measurements — vendor devices interleave battery, config
 * and vitals packets on one characteristic, so a rejected frame is normal
 * traffic rather than an error.
 */
export async function connect(
  device: ScannedDevice,
  adapter: Adapter,
  handlers: ConnectHandlers,
): Promise<Connection> {
  await BleClient.connect(device.deviceId, (id) => handlers.onDisconnect?.(id))

  try {
    await BleClient.discoverServices(device.deviceId).catch(() => {})

    // some devices need a companion subscription before they will stream
    for (const extra of adapter.extraSubscriptions?.(device) ?? []) {
      await BleClient.startNotifications(
        device.deviceId,
        extra.service,
        extra.characteristic,
        () => {},
      )
    }

    const target = adapter.target(device)
    await BleClient.startNotifications(
      device.deviceId,
      target.service,
      target.characteristic,
      (view) => {
        const measurement = adapter.parse(view)
        handlers.onFrame?.(toHex(view), measurement !== null)
        if (measurement) handlers.onMeasurement(measurement)
      },
    )
  } catch (error) {
    await BleClient.disconnect(device.deviceId).catch(() => {})
    throw error
  }

  return {
    deviceId: device.deviceId,
    adapter,
    async resubscribe() {
      const target = adapter.target(device)
      await BleClient.stopNotifications(
        device.deviceId,
        target.service,
        target.characteristic,
      ).catch(() => {})
      await BleClient.discoverServices(device.deviceId).catch(() => {})
      await BleClient.startNotifications(
        device.deviceId,
        target.service,
        target.characteristic,
        (view) => {
          const measurement = adapter.parse(view)
          handlers.onFrame?.(toHex(view), measurement !== null)
          if (measurement) handlers.onMeasurement(measurement)
        },
      )
    },
    async disconnect() {
      const target = adapter.target(device)
      await BleClient.stopNotifications(
        device.deviceId,
        target.service,
        target.characteristic,
      ).catch(() => {})
      await BleClient.disconnect(device.deviceId).catch(() => {})
    },
  }
}

/**
 * Bonding state. An unbonded link cannot read or subscribe to characteristics
 * the peripheral marks as requiring encryption, and the failure is silent —
 * the subscription is accepted and nothing ever arrives.
 */
export async function isBonded(deviceId: string): Promise<boolean> {
  try {
    return await BleClient.isBonded(deviceId)
  } catch {
    return false
  }
}

export async function createBond(deviceId: string): Promise<void> {
  await BleClient.createBond(deviceId)
}

/**
 * The browser chooser's filter list: any service we speak, OR any name prefix
 * an adapter accepts in its place.
 *
 * Each entry is its own filter because Web Bluetooth ORs the entries and ANDs
 * the fields inside one. The plugin's requestDevice folds a name prefix into
 * every service entry, which turns "this service or this name" into "this
 * service and this name" — so the filters are built here and handed to the
 * browser directly.
 */
export function chooserFilters(
  services: string[],
  namePrefixes: string[],
): BluetoothLEScanFilter[] {
  return [
    ...services.map((service) => ({ services: [service] })),
    ...namePrefixes.map((namePrefix) => ({ namePrefix })),
  ]
}

/**
 * Pick a device through the browser's own chooser.
 *
 * Web Bluetooth deliberately gives no continuous scan by default — the
 * equivalent API sits behind a Chromium flag — so on the web the browser owns
 * device selection and the app never sees anything the user did not pick.
 *
 * The chooser lists only what the filters admit, and a filter on service UUID
 * alone misses a real class of device: a 128-bit UUID is 18 of the 31 bytes an
 * advertisement has, and BerryMed oximeters among others spend those bytes on
 * the name instead. The manufacturer's app found a BM1000C that this chooser
 * could not, which is how that came to light. So the name prefixes go in too.
 *
 * `optionalServices` matters more than it looks: Web Bluetooth blocks access
 * to any service not declared up front, so every service the adapters might
 * need has to be listed here or the GATT calls fail after connecting.
 */
export async function chooseDevice(mode: ScanMode = 'compatible'): Promise<ScannedDevice | null> {
  const services = scanServiceUUIDs()
  try {
    // 'all' is the web's answer to the unfiltered scan: the plugin opens the
    // chooser with acceptAllDevices when it is given nothing to filter on.
    // It depends on no API beyond requestDevice itself, which is the point —
    // it is the mode for finding out why the filtered one shows nothing.
    const device =
      mode === 'all'
        ? await BleClient.requestDevice({ optionalServices: services })
        : await pickInBrowser(services)
    return {
      deviceId: device.deviceId,
      name: device.name ?? undefined,
      // the chooser reports no advertisement data, so the adapter is resolved
      // after connecting, from the real service table
      serviceUUIDs: [],
    }
  } catch (error) {
    // the chooser was dismissed — not an error worth surfacing
    const message = error instanceof Error ? error.message : String(error)
    if (/cancell?ed|user denied|no device selected/i.test(message)) return null
    throw error
  }
}

/**
 * Open the chooser with OR-ed filters where the browser allows it.
 *
 * The plugin keeps its own map of devices the browser has handed it, and every
 * later call — connect, subscribe — looks the device up there. A device picked
 * outside the plugin has to be registered with it, and getDevices() is the
 * only door in: it re-reads the browser's permitted-device list, which holds
 * the pick as long as the browser persists Bluetooth permissions (Chromium has
 * since 121). Where it does not, the plugin's own chooser is the fallback,
 * with the service-only list it always had.
 */
async function pickInBrowser(services: string[]): Promise<{ deviceId: string; name?: string }> {
  const bluetooth = typeof navigator !== 'undefined' ? navigator.bluetooth : undefined
  if (!bluetooth || typeof bluetooth.getDevices !== 'function') {
    return BleClient.requestDevice({ services, optionalServices: services })
  }

  const picked = await bluetooth.requestDevice({
    filters: chooserFilters(services, scanNamePrefixes()),
    optionalServices: services,
  })
  const devices = await BleClient.getDevices([picked.id])
  if (devices.length > 0) return devices[0]

  // the browser did not keep the permission, so the plugin cannot see the
  // pick; its own chooser can still get us a device, at the cost of a second
  // dialog and the narrower list
  return BleClient.requestDevice({ services, optionalServices: services })
}

export interface Inspection {
  deviceId: string
  services: string[]
  /** adapter matched against the post-connection service list */
  adapter: Adapter | null
}

/**
 * Connect to a device, read its real GATT service list, and disconnect.
 *
 * Advertising packets are small and devices routinely omit services they
 * actually implement — a watch can support Heart Rate and never say so until
 * you connect. This is how those get found.
 */
export async function inspect(device: ScannedDevice): Promise<Inspection> {
  await BleClient.connect(device.deviceId)
  try {
    await BleClient.discoverServices(device.deviceId).catch(() => {})
    const services = (await BleClient.getServices(device.deviceId)).map((s) => normalize(s.uuid))
    // re-match using what the device really has, not what it advertised
    const adapter = resolveAdapter({ ...device, serviceUUIDs: services })
    return { deviceId: device.deviceId, services, adapter }
  } finally {
    await BleClient.disconnect(device.deviceId).catch(() => {})
  }
}

/**
 * Devices the phone already knows about — bonded (paired in system settings)
 * or currently connected to another app.
 *
 * This matters more than it sounds. Android omits connected devices from LE
 * scan results entirely, so a watch that is talking to its own companion app
 * is invisible to a scan no matter what filter is used. Enumerating them
 * separately is the only way to reach one.
 *
 * Neither call reports service UUIDs, so these devices always need `inspect`
 * before we can tell whether we support them.
 */
export async function listKnownDevices(): Promise<ScannedDevice[]> {
  const [connected, bonded] = await Promise.all([
    BleClient.getConnectedDevices(scanServiceUUIDs()).catch(() => []),
    BleClient.getBondedDevices().catch(() => []),
  ])

  const byId = new Map<string, ScannedDevice>()
  // connected first so it wins the dedupe
  for (const d of [...connected, ...bonded]) {
    if (byId.has(d.deviceId)) continue
    byId.set(d.deviceId, {
      deviceId: d.deviceId,
      name: d.name ?? undefined,
      serviceUUIDs: [],
    })
  }
  return [...byId.values()]
}

/**
 * Retry a GATT call once after a pause.
 *
 * Chromium's Web Bluetooth stack reports transient failures as an opaque
 * "GATT operation failed for unknown reason", and a single retry clears most
 * of them. Worth one attempt before telling the user something is wrong.
 */
async function retryOnce<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!/gatt|unknown reason|network error/i.test(message)) throw error
    await new Promise((resolve) => setTimeout(resolve, 700))
    return work()
  }
}

async function openNotifications(
  device: ScannedDevice,
  adapter: Adapter,
  handlers: ConnectHandlers,
): Promise<void> {
  for (const extra of adapter.extraSubscriptions?.(device) ?? []) {
    await BleClient.startNotifications(
      device.deviceId,
      extra.service,
      extra.characteristic,
      () => {},
    )
  }

  const target = adapter.target(device)
  await retryOnce(() =>
    BleClient.startNotifications(device.deviceId, target.service, target.characteristic, (view) => {
      const measurement = adapter.parse(view)
      handlers.onFrame?.(toHex(view), measurement !== null)
      if (measurement) handlers.onMeasurement(measurement)
    }),
  )
}

function makeConnection(
  device: ScannedDevice,
  adapter: Adapter,
  handlers: ConnectHandlers,
): Connection {
  return {
    deviceId: device.deviceId,
    adapter,
    async resubscribe() {
      const target = adapter.target(device)
      await BleClient.stopNotifications(
        device.deviceId,
        target.service,
        target.characteristic,
      ).catch(() => {})
      await openNotifications(device, adapter, handlers)
    },
    async disconnect() {
      const target = adapter.target(device)
      await BleClient.stopNotifications(
        device.deviceId,
        target.service,
        target.characteristic,
      ).catch(() => {})
      await BleClient.disconnect(device.deviceId).catch(() => {})
    },
  }
}

export interface ResolvedConnection {
  /** null when nothing on the device is supported */
  connection: Connection | null
  adapter: Adapter | null
  /** what the device really exposes, for reporting an unsupported one */
  services: string[]
}

/**
 * Connect once, work out what the device is, and subscribe — without ever
 * dropping the link in between.
 *
 * Identifying a device used to mean connecting, reading its services,
 * disconnecting, then connecting again to stream. Native tolerates that; the
 * browser frequently does not, and the second connect fails with an opaque
 * GATT error. One connection, start to finish.
 */
export async function connectAndResolve(
  device: ScannedDevice,
  handlers: ConnectHandlers,
): Promise<ResolvedConnection> {
  await retryOnce(() => BleClient.connect(device.deviceId, (id) => handlers.onDisconnect?.(id)))

  try {
    // native only; the browser discovers as part of connecting
    await BleClient.discoverServices(device.deviceId).catch(() => {})

    const services = (await BleClient.getServices(device.deviceId)).map((x) => normalize(x.uuid))
    const withServices: ScannedDevice = { ...device, serviceUUIDs: services }
    const adapter = resolveAdapter(withServices)

    if (!adapter) {
      await BleClient.disconnect(device.deviceId).catch(() => {})
      return { connection: null, adapter: null, services }
    }

    await openNotifications(withServices, adapter, handlers)
    return { connection: makeConnection(withServices, adapter, handlers), adapter, services }
  } catch (error) {
    await BleClient.disconnect(device.deviceId).catch(() => {})
    throw error
  }
}
