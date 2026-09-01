import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { resolveTheme } from './theme'

/* The stylesheet as text. Read from disk rather than imported: vitest stubs
   CSS imports to an empty string, and these assertions are about the CSS
   source itself rather than a rendered document. */
const css = readFileSync(fileURLToPath(new URL('./index.css', import.meta.url)), 'utf8')

/* Comments are stripped once, up front. A palette comment naming a token and a
   number — "--panel: 4.11" — otherwise parses as a declaration and swallows
   the real one after it, which surfaces as a missing token rather than as a
   confused test. */
const source = css.replace(/\/\*[\s\S]*?\*\//g, '')

/** The declarations inside one top-level rule, by selector. */
function block(selector: string): string {
  const start = source.indexOf(selector + ' {')
  expect(start, `missing rule for ${selector}`).toBeGreaterThan(-1)
  const open = source.indexOf('{', start)
  return source.slice(open + 1, source.indexOf('}', open))
}

function tokens(selector: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [, name, value] of block(selector).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    out[name] = value.trim()
  }
  return out
}

describe('theme palettes', () => {
  const dark = tokens(':root')
  const light = tokens(":root[data-theme='light']")

  /**
   * The failure this prevents is invisible in the theme you develop in: a new
   * token defined only under :root inherits its dark value into light mode, so
   * dark text lands on a dark panel and the control disappears entirely.
   */
  it('defines the same tokens in both palettes', () => {
    expect(Object.keys(light).sort()).toEqual(Object.keys(dark).sort())
  })

  it('gives every token its own value per theme', () => {
    // --on-warn and --warn-fill are deliberately shared: an alarm chip is the
    // same amber with the same near-black on it in either theme
    const shared = ['--on-warn', '--warn-fill']
    for (const [name, value] of Object.entries(dark)) {
      if (shared.includes(name)) expect(light[name]).toBe(value)
      else expect(light[name], `${name} was not re-stated for light`).not.toBe(value)
    }
  })

  it('sets color-scheme per theme, so form controls follow', () => {
    expect(block(':root')).toContain('color-scheme: dark')
    expect(block(":root[data-theme='light']")).toContain('color-scheme: light')
  })

  /**
   * Every colour has to come from a token or it cannot be themed. This caught
   * roughly two dozen literals when light mode was added; it is here so the
   * next one is caught at the commit rather than on a screen in the field.
   */
  it('has no colour literals outside the palettes', () => {
    const lightRule = source.indexOf(":root[data-theme='light'] {")
    const rest = source.slice(source.indexOf('}', lightRule) + 1)
    expect(rest.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(/g)).toBeNull()
  })
})

describe('resolveTheme', () => {
  it('honours an explicit choice', () => {
    expect(resolveTheme('light')).toBe('light')
    expect(resolveTheme('dark')).toBe('dark')
  })
})
