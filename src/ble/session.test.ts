/**
 * The browser chooser's filter list.
 *
 * Web Bluetooth ORs the entries in `filters` and ANDs the fields inside each
 * one. The distinction is the whole bug: a name prefix folded into a service
 * entry admits only devices with both, and a BerryMed oximeter advertising its
 * name and not its UUID has one.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const requestDevice = vi.fn()
const getDevices = vi.fn()
vi.mock('@capacitor-community/bluetooth-le', () => ({
  BleClient: {
    requestDevice: (...args: unknown[]) => requestDevice(...args),
    getDevices: (...args: unknown[]) => getDevices(...args),
  },
}))

import { chooseDevice, chooserFilters } from './session'

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

/*
 * The plugin opens the browser's chooser with acceptAllDevices only when it is
 * handed nothing to filter on. This mode exists for the device the filtered
 * list cannot show, so any filter here defeats it.
 */
describe('choosing every nearby device', () => {
  beforeEach(() => {
    requestDevice.mockReset()
    getDevices.mockReset()
  })

  it('asks the plugin for a chooser with no filter at all', async () => {
    requestDevice.mockResolvedValue({ deviceId: 'ox-1', name: 'BM1000C-O' })
    const picked = await chooseDevice('all')

    expect(requestDevice).toHaveBeenCalledTimes(1)
    const options = requestDevice.mock.calls[0][0] as Record<string, unknown>
    expect(options.services).toBeUndefined()
    expect(options.name).toBeUndefined()
    expect(options.namePrefix).toBeUndefined()
    // but every service must still be declared, or GATT access fails after connecting
    expect(options.optionalServices).toEqual(expect.arrayContaining([expect.any(String)]))

    expect(picked).toEqual({ deviceId: 'ox-1', name: 'BM1000C-O', serviceUUIDs: [] })
  })

  it('treats a dismissed chooser as no pick, not an error', async () => {
    requestDevice.mockRejectedValue(new Error('User cancelled the requestDevice() chooser.'))
    await expect(chooseDevice('all')).resolves.toBeNull()
  })
})
