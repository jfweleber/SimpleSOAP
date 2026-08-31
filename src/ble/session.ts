/**
 * BLE scanning and connection, on top of @capacitor-community/bluetooth-le.
 *
 * Two scan modes. The filtered scan asks the OS for devices advertising a
 * service we support, which in a populated area is the difference between a
 * three-line list and a hundred-line one. The unfiltered scan takes every
 * advertisement and is for working out why a device is not showing up.
 */

import { BleClient, type ScanResult } from '@capacitor-community/bluetooth-le'
import type { Adapter, Measurement, ScannedDevice } from './types'
import { resolveAdapter, scanServiceUUIDs } from './adapters'
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
 * Pick a device through the browser's own chooser.
 *
 * Web Bluetooth deliberately gives no continuous scan by default — the
 * equivalent API sits behind a Chromium flag — so on the web the browser owns
 * device selection and the app never sees anything the user did not pick.
 *
 * `optionalServices` matters more than it looks: Web Bluetooth blocks access
 * to any service not declared up front, so every service the adapters might
 * need has to be listed here or the GATT calls fail after connecting.
 */
export async function chooseDevice(): Promise<ScannedDevice | null> {
  const services = scanServiceUUIDs()
  try {
    const device = await BleClient.requestDevice({
      services,
      optionalServices: services,
    })
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
