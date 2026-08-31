/**
 * Time formatting, in one place.
 *
 * Everything is 24-hour. A patient report crossing midnight or being read back
 * hours later cannot afford an ambiguous "07:15", and every agency this note
 * gets handed to charts in 24-hour anyway.
 *
 * `hourCycle: 'h23'` rather than `hour12: false` — the latter renders midnight
 * as 24:00 in some engines, which is exactly the kind of thing nobody notices
 * until a report says a patient was found at 24:10.
 */

const TIME: Intl.DateTimeFormatOptions = {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
}

const DATE_TIME: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  ...TIME,
}

/** 24-hour clock time, e.g. 14:07. */
export function hhmm(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—'
  return new Date(ms).toLocaleTimeString([], TIME)
}

/** Date and 24-hour time, e.g. 30 Aug 2026, 14:07. */
export function dateTimeText(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—'
  return new Date(ms).toLocaleString([], DATE_TIME)
}

/** Time today, date otherwise — for lists where most entries are recent. */
export function whenText(ms: number): string {
  const d = new Date(ms)
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  return sameDay
    ? d.toLocaleTimeString([], TIME)
    : d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

/** Celsius to Fahrenheit, for migrating records stored before the change. */
export function celsiusToFahrenheit(c: number): number {
  return Math.round((c * 9) / 5 + 32)
}
