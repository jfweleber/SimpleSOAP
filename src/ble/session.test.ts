/**
 * The browser chooser.
 *
 * The plugin opens Web Bluetooth's chooser with acceptAllDevices only when it
 * is handed nothing to filter on. A BM1000C that the manufacturer's app could
 * see appeared in the chooser only once every filter was gone: it advertises
 * its name and not its service UUID, and the plugin cannot OR the two. Any
 * filter reintroduced here reintroduces that.
 *
 * The plugin is stubbed with a swappable implementation rather than a
 * module-level vi.fn(): under vitest 4.1 a rejection returned by the latter
 * was reported against the test even after chooseDevice() had caught it and
 * resolved to null.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

type RequestOptions = Record<string, unknown>
let calls: RequestOptions[] = []
let impl: () => Promise<{ deviceId: string; name?: string }> = () =>
  Promise.resolve({ deviceId: 'none' })

vi.mock('@capacitor-community/bluetooth-le', () => ({
  BleClient: {
    requestDevice: (options: RequestOptions) => {
      calls.push(options)
      return impl()
    },
  },
}))

import { chooseDevice } from './session'

describe('choosing a device in the browser', () => {
  beforeEach(() => {
    calls = []
  })

  it('asks for a chooser with no filter at all', async () => {
    impl = () => Promise.resolve({ deviceId: 'ox-1', name: 'BM1000C-O' })
    const picked = await chooseDevice()

    expect(calls).toHaveLength(1)
    expect(calls[0].services).toBeUndefined()
    expect(calls[0].name).toBeUndefined()
    expect(calls[0].namePrefix).toBeUndefined()
    // but every service must still be declared, or GATT access fails after connecting
    expect(calls[0].optionalServices).toEqual(expect.arrayContaining([expect.any(String)]))

    expect(picked).toEqual({ deviceId: 'ox-1', name: 'BM1000C-O', serviceUUIDs: [] })
  })

  it('treats a dismissed chooser as no pick, not an error', async () => {
    impl = () => Promise.reject(new Error('User cancelled the requestDevice() chooser.'))
    expect(await chooseDevice()).toBeNull()
  })

  it('surfaces any other failure', async () => {
    impl = () => Promise.reject(new Error('Bluetooth adapter not available.'))
    await expect(chooseDevice()).rejects.toThrow('adapter not available')
  })
})
