import { useCallback, useEffect, useState } from 'react'
import { isIOS, isNative, requestPersistentStorage } from './platform'

/**
 * Installing to the home screen, on the two very different paths browsers give
 * us for it.
 *
 * This is not a cosmetic upgrade. A browser evicts script-writable storage for
 * sites it decides are idle, and these are patient records that can sit
 * untouched for weeks between callouts. Installing is the single largest factor
 * in `navigator.storage.persist()` being granted, so the install button is the
 * strongest lever the app has against losing a note it was trusted with.
 */

/**
 * Chromium fires this to offer the install; it is not in TypeScript's DOM lib
 * because no other engine implements it.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export type InstallState =
  /** nothing to offer: already a native shell, or already installed */
  | 'unavailable'
  /** the browser has handed us a prompt we can fire */
  | 'ready'
  /** WebKit has no install API, so the user has to be told the steps */
  | 'ios'

/**
 * Already running from the home screen?
 *
 * `display-mode` covers every browser that implements the manifest. iOS Safari
 * predates it and reports standalone on `navigator` instead, so both are
 * checked — otherwise an installed iPhone keeps being told to install.
 */
export function isInstalled(): boolean {
  if (typeof window === 'undefined') return false
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true
  return window.matchMedia('(display-mode: standalone)').matches || standalone
}

export function useInstallPrompt(): {
  state: InstallState
  /** fires the browser prompt; resolves true when the app was installed */
  install: () => Promise<boolean>
} {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState(() => isInstalled())

  useEffect(() => {
    if (isNative()) return

    const offer = (event: Event) => {
      // without this Chromium shows its own bar as well as ours
      event.preventDefault()
      setPrompt(event as BeforeInstallPromptEvent)
    }
    const done = () => {
      setInstalled(true)
      setPrompt(null)
    }

    window.addEventListener('beforeinstallprompt', offer)
    window.addEventListener('appinstalled', done)

    // installing from the browser's own menu leaves our button standing, and
    // the tab it was launched from switches display-mode without reloading
    const display = window.matchMedia('(display-mode: standalone)')
    const sync = () => setInstalled(isInstalled())
    display.addEventListener('change', sync)

    return () => {
      window.removeEventListener('beforeinstallprompt', offer)
      window.removeEventListener('appinstalled', done)
      display.removeEventListener('change', sync)
    }
  }, [])

  const install = useCallback(async (): Promise<boolean> => {
    if (!prompt) return false
    await prompt.prompt()
    const { outcome } = await prompt.userChoice
    // the event is single-use whatever the answer was
    setPrompt(null)
    if (outcome !== 'accepted') return false
    setInstalled(true)
    // ask again now that the odds are good: a browser that refused to make our
    // storage persistent for a tab will often grant it for an installed app
    await requestPersistentStorage()
    return true
  }, [prompt])

  const state: InstallState =
    isNative() || installed ? 'unavailable' : prompt ? 'ready' : isIOS() ? 'ios' : 'unavailable'

  return { state, install }
}
