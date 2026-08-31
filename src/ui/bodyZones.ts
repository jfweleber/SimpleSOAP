/**
 * Geometry for the body map.
 *
 * Shared by the on-screen diagram and the printed report so the two can never
 * drift apart — a region that moves on screen moves on the PDF as well.
 *
 * Canvas is 220 x 322. Left and right are the PATIENT's throughout, which is
 * mirrored on screen: patient right sits on the viewer's left.
 */

import type { BodyRegion } from '../model/types'

export interface Zone {
  region: BodyRegion
  shape: 'ellipse' | 'rect'
  attrs: Record<string, number>
  /** badge anchor */
  bx: number
  by: number
}

export const BODY_VIEWBOX = { width: 220, height: 322 }

const rect = (
  region: BodyRegion,
  x: number,
  y: number,
  width: number,
  height: number,
  rx = 5,
): Zone => ({
  region,
  shape: 'rect',
  attrs: { x, y, width, height, rx },
  bx: x + width / 2,
  by: y + height / 2,
})

export const BODY_ZONES: Zone[] = [
  { region: 'Head', shape: 'ellipse', attrs: { cx: 110, cy: 24, rx: 18, ry: 22 }, bx: 110, by: 16 },
  { region: 'Face', shape: 'ellipse', attrs: { cx: 110, cy: 32, rx: 11, ry: 12 }, bx: 110, by: 33 },
  rect('Neck', 101, 45, 18, 13, 4),

  rect('Chest', 80, 58, 60, 40, 7),

  // quadrants — patient right is the viewer's left
  rect('Abdomen RUQ', 81, 99, 28, 19, 3),
  rect('Abdomen LUQ', 111, 99, 28, 19, 3),
  rect('Abdomen RLQ', 81, 120, 28, 19, 3),
  rect('Abdomen LLQ', 111, 120, 28, 19, 3),

  rect('Pelvis', 83, 141, 54, 26, 9),

  rect('R upper arm', 58, 62, 19, 48, 8),
  rect('R elbow', 55, 112, 19, 17, 7),
  rect('R forearm', 51, 131, 19, 44, 8),
  rect('R hand', 46, 177, 21, 23, 8),

  rect('L upper arm', 143, 62, 19, 48, 8),
  rect('L elbow', 146, 112, 19, 17, 7),
  rect('L forearm', 150, 131, 19, 44, 8),
  rect('L hand', 153, 177, 21, 23, 8),

  rect('R thigh', 84, 169, 23, 54, 9),
  rect('R knee', 84, 225, 23, 19, 8),
  rect('R lower leg', 85, 246, 21, 50, 8),
  rect('R foot', 80, 298, 27, 18, 6),

  rect('L thigh', 113, 169, 23, 54, 9),
  rect('L knee', 113, 225, 23, 19, 8),
  rect('L lower leg', 114, 246, 21, 50, 8),
  rect('L foot', 113, 298, 27, 18, 6),
]

/** The one region with no place on the front view. */
export const OFF_DIAGRAM_REGION: BodyRegion = 'Back / Spine'

/** Serialize a zone's shape as an SVG element string, for the printed report. */
export function zoneToSvg(zone: Zone, attributes: string): string {
  const a = zone.attrs
  return zone.shape === 'ellipse'
    ? `<ellipse cx="${a.cx}" cy="${a.cy}" rx="${a.rx}" ry="${a.ry}" ${attributes}/>`
    : `<rect x="${a.x}" y="${a.y}" width="${a.width}" height="${a.height}" rx="${a.rx}" ${attributes}/>`
}
