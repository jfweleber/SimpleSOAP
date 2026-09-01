import { useCallback, useEffect, useState } from 'react'

/**
 * Light and dark, with the operating system as the default.
 *
 * Dark was the only palette for a long time and it is still the right one for
 * a night callout. Light exists because a dark screen washes out in direct
 * sun, which is most of a daylight search — so this is a legibility setting,
 * not decoration, and both palettes are held to the same contrast bar.
 *
 * The resolved theme is always stamped on <html> as data-theme, so the
 * stylesheet needs one override block rather than a duplicated pair of
 * media-query and attribute rules that could drift apart.
 */

export type ThemeChoice = 'light' | 'dark' | 'system'
export type Theme = 'light' | 'dark'

/** Also read by the inline script in index.html; keep the two in step. */
export const THEME_KEY = 'simplesoap.theme'

/** Page background per theme, mirroring --bg. Drives the theme-color meta. */
const CHROME: Record<Theme, string> = { dark: '#0c1116', light: '#f2f5f7' }

export function storedChoice(): ThemeChoice {
  try {
    const raw = localStorage.getItem(THEME_KEY)
    return raw === 'light' || raw === 'dark' ? raw : 'system'
  } catch {
    // private mode can throw on access alone; following the system is a fine
    // answer when we are not allowed to remember anything
    return 'system'
  }
}

export function systemTheme(): Theme {
  if (typeof window === 'undefined') return 'dark'
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

export function resolveTheme(choice: ThemeChoice): Theme {
  return choice === 'system' ? systemTheme() : choice
}

/**
 * Put the theme on the document.
 *
 * `theme-color` moves with it, or the installed app keeps a dark title bar and
 * Android a dark status bar above a light page.
 */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', CHROME[theme])
}

/** Stamp whatever was chosen last. Called before the first render. */
export function initTheme(): Theme {
  const theme = resolveTheme(storedChoice())
  applyTheme(theme)
  return theme
}

export function saveChoice(choice: ThemeChoice): void {
  try {
    if (choice === 'system') localStorage.removeItem(THEME_KEY)
    else localStorage.setItem(THEME_KEY, choice)
  } catch {
    // the toggle still works for this session; it just will not be remembered
  }
}

/**
 * Watch the operating system, for as long as we are following it.
 *
 * Returns an unsubscribe. A responder who has never touched the toggle should
 * follow the phone into night mode without reopening the app.
 */
export function watchSystem(onChange: (theme: Theme) => void): () => void {
  const query = window.matchMedia('(prefers-color-scheme: light)')
  const handler = () => {
    if (storedChoice() === 'system') onChange(systemTheme())
  }
  query.addEventListener('change', handler)
  return () => query.removeEventListener('change', handler)
}

/**
 * The toggle's state.
 *
 * One button, two visible states — the third, "follow the system", is the
 * starting point rather than a stop on a cycle. Nobody standing in the rain
 * wants to press a button three times to get back where they were.
 */
export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(() => resolveTheme(storedChoice()))

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  useEffect(() => watchSystem(setTheme), [])

  const toggle = useCallback(() => {
    setTheme((current) => {
      const next: Theme = current === 'dark' ? 'light' : 'dark'
      saveChoice(next)
      return next
    })
  }, [])

  return { theme, toggle }
}
