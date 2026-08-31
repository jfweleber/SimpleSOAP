import { Capacitor } from '@capacitor/core'

/**
 * What this build can actually do, on this device.
 *
 * The same code ships three ways — an Android app, a browser tab, and an
 * installed web app — and they do not have the same powers. Rather than
 * guessing from the user agent, each capability is probed for what it needs.
 */

export const isNative = (): boolean => Capacitor.isNativePlatform()

/**
 * Web Bluetooth exists in Chromium browsers and nowhere on iOS.
 *
 * Every iOS browser is required to use WebKit, which has never implemented it,
 * so Chrome and Firefox on an iPhone cannot provide it either. This is a
 * standing platform decision rather than a version gap, so the app says so
 * plainly instead of showing a scan that can never find anything.
 */
export const hasWebBluetooth = (): boolean =>
  typeof navigator !== 'undefined' && 'bluetooth' in navigator

export const canUseBluetooth = (): boolean => isNative() || hasWebBluetooth()

/** Web Bluetooth and service workers both require a secure context. */
export const isSecureContext = (): boolean =>
  typeof window === 'undefined' || window.isSecureContext

export type BluetoothBlocker =
  | 'none'
  | 'insecure-context'
  | 'ios'
  | 'unsupported-browser'
  /** the API exists but the browser reports no usable radio */
  | 'radio-unavailable'
  /** Brave ships Web Bluetooth switched off; only a browser flag turns it on */
  | 'brave-disabled'
  | 'checking'

/** Synchronous part: is the API here at all. */
export function bluetoothBlocker(): BluetoothBlocker {
  if (canUseBluetooth()) return 'none'
  if (!isSecureContext()) return 'insecure-context'
  if (isIOS()) return 'ios'
  return 'unsupported-browser'
}

/**
 * Brave exposes navigator.bluetooth but keeps the API globally disabled, so
 * availability reports false no matter what the operating system has granted.
 * Worth naming, because the generic advice — turn Bluetooth on, grant the
 * browser nearby-devices — is a dead end there.
 */
export async function isBrave(): Promise<boolean> {
  try {
    const brave = (navigator as Navigator & { brave?: { isBrave(): Promise<boolean> } }).brave
    return (await brave?.isBrave()) ?? false
  } catch {
    return false
  }
}

/**
 * The full check, including whether a radio is actually usable.
 *
 * `getAvailability` is the difference between "this browser could do Bluetooth"
 * and "this browser can do Bluetooth right now". It returns false when there is
 * no adapter at all, and also when the browser itself has been denied the
 * operating system's nearby-devices permission — which looks identical from
 * script but has a completely different fix.
 */
export async function checkBluetooth(): Promise<BluetoothBlocker> {
  if (isNative()) return 'none'
  const initial = bluetoothBlocker()
  if (initial !== 'none') return initial
  try {
    const available = await (
      navigator as Navigator & { bluetooth: { getAvailability(): Promise<boolean> } }
    ).bluetooth.getAvailability()
    if (available) return 'none'
    return (await isBrave()) ? 'brave-disabled' : 'radio-unavailable'
  } catch {
    return (await isBrave()) ? 'brave-disabled' : 'radio-unavailable'
  }
}

export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  // iPadOS reports itself as a Mac, so a touch-capable "Mac" is really an iPad
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
}

/**
 * Ask the browser to exempt our data from routine eviction.
 *
 * Browsers clear script-writable storage for sites that have not been used
 * recently, and these are patient records that may sit untouched between
 * callouts. Granting is at the browser's discretion — installing to the home
 * screen makes it far more likely — so this is a request, not a guarantee, and
 * the backup export exists precisely because it can be refused.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false
    if (await navigator.storage.persisted()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}

export async function storageIsPersistent(): Promise<boolean> {
  try {
    return (await navigator.storage?.persisted?.()) ?? false
  } catch {
    return false
  }
}
