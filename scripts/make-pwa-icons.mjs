import { mkdirSync } from 'node:fs'
import sharp from 'sharp'

const BG = '#132C33', PIN = '#4FD1B0', TRACE = '#0E2226'
const P = 'M54 16 c-16 0 -28 12 -28 27 c0 19 22 38 28 49 c6 -11 28 -30 28 -49 c0 -15 -12 -27 -28 -27 Z'
const T = 'M39 43 H47 L50 35 L55 53 L59 43 H69'

const art = (scale) =>
  `<g transform="translate(54,54) scale(${scale}) translate(-54,-54)">` +
  `<path d="${P}" fill="${PIN}"/>` +
  `<path d="${T}" fill="none" stroke="${TRACE}" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/></g>`

const svg = (scale) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108" width="108" height="108">` +
  `<rect width="108" height="108" fill="${BG}"/>${art(scale)}</svg>`

mkdirSync('public/icons', { recursive: true })

// plain icons use the full mark; maskable ones shrink into the safe zone so
// a launcher mask cannot crop the pin
for (const size of [192, 512]) {
  await sharp(Buffer.from(svg(1))).resize(size, size).png().toFile(`public/icons/icon-${size}.png`)
  await sharp(Buffer.from(svg(0.7))).resize(size, size).png().toFile(`public/icons/maskable-${size}.png`)
  console.log('icon', size)
}
await sharp(Buffer.from(svg(1))).resize(180, 180).png().toFile('public/icons/apple-touch-icon.png')
await sharp(Buffer.from(svg(1))).resize(32, 32).png().toFile('public/favicon.png')
console.log('done')
