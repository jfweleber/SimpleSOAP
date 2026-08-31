/**
 * Parser tests against synthetic frames.
 *
 * None of the vendor adapters can be tested against real hardware until a
 * device is in hand, so these exist to catch transcription errors in the
 * offsets, sentinels and bit math — the failures that would otherwise show up
 * as a silent wrong number on a patient report.
 */

import { describe, expect, it } from 'vitest'
import {
  berryMedAdapter,
  choiceMMedAdapter,
  ffe0Adapter,
  heartRateAdapter,
  jumperAdapter,
  plxAdapter,
  resolveAdapter,
  viatomAdapter,
} from './adapters'
import { FFE0_SERVICE, HEART_RATE_SERVICE, ISSC_SERVICE, PLX_SERVICE } from './uuid'

const frame = (...bytes: number[]) => new DataView(Uint8Array.from(bytes).buffer)

describe('heart rate (GATT 0x180D)', () => {
  it('reads an 8-bit rate when flags bit 0 is clear', () => {
    const m = heartRateAdapter.parse(frame(0x00, 72))
    expect(m?.heartRate).toBe(72)
    // contact unsupported, so the field must be null rather than false
    expect(m?.sensorContact).toBeNull()
  })

  it('reads a 16-bit rate when flags bit 0 is set', () => {
    // 300 bpm little-endian — above what uint8 can carry
    const m = heartRateAdapter.parse(frame(0x01, 0x2c, 0x01))
    expect(m?.heartRate).toBe(300)
  })

  it('reports contact only when the device says it supports it', () => {
    // bit 2 supported, bit 1 detected
    expect(heartRateAdapter.parse(frame(0x06, 60))?.sensorContact).toBe(true)
    // bit 2 supported, bit 1 clear
    expect(heartRateAdapter.parse(frame(0x04, 60))?.sensorContact).toBe(false)
    // bit 1 set but unsupported — must not be trusted
    expect(heartRateAdapter.parse(frame(0x02, 60))?.sensorContact).toBeNull()
  })

  it('converts RR intervals from 1/1024 s to ms', () => {
    // flags: contact supported + detected + RR present
    const m = heartRateAdapter.parse(frame(0x16, 72, 0x00, 0x04, 0x00, 0x02))
    expect(m?.rrIntervals).toEqual([1000, 500])
  })

  it('skips the energy expended field before reading RR intervals', () => {
    // flags: energy present (bit 3) + RR present (bit 4)
    const m = heartRateAdapter.parse(frame(0x18, 72, 0xff, 0xff, 0x00, 0x04))
    expect(m?.heartRate).toBe(72)
    expect(m?.rrIntervals).toEqual([1000])
  })
})

describe('pulse oximeter (GATT 0x1822)', () => {
  it('decodes SFLOAT saturation and pulse', () => {
    // exponent 0, mantissa 98 / 72
    const m = plxAdapter.parse(frame(0x00, 0x62, 0x00, 0x48, 0x00))
    expect(m?.spo2).toBe(98)
    expect(m?.heartRate).toBe(72)
  })

  it('applies a negative exponent', () => {
    // exponent -1 (0xF), mantissa 975 => 97.5
    const m = plxAdapter.parse(frame(0x00, 0xcf, 0xf3, 0x48, 0x00))
    expect(m?.spo2).toBeCloseTo(97.5)
  })

  it('treats the reserved mantissa range as no reading', () => {
    // 0x07FF is NaN in IEEE-11073
    const m = plxAdapter.parse(frame(0x00, 0xff, 0x07, 0x48, 0x00))
    expect(m?.spo2).toBeNull()
    expect(m?.sensorContact).toBe(false)
  })
})

describe('BerryMed / BCI', () => {
  it('reads pulse at offset 3 and saturation at offset 4', () => {
    const m = berryMedAdapter.parse(frame(0x00, 0x00, 0x00, 72, 98))
    expect(m?.heartRate).toBe(72)
    expect(m?.spo2).toBe(98)
  })

  it('treats a zero in either field as no contact', () => {
    expect(berryMedAdapter.parse(frame(0, 0, 0, 0, 98))?.sensorContact).toBe(false)
    expect(berryMedAdapter.parse(frame(0, 0, 0, 72, 0))?.sensorContact).toBe(false)
  })

  it('matches on device name when no service UUID is advertised', () => {
    expect(berryMedAdapter.matches({ deviceId: 'x', name: 'BerryMed_1234' })).toBe(true)
    expect(berryMedAdapter.matches({ deviceId: 'x', name: 'BM1000C' })).toBe(true)
    expect(berryMedAdapter.matches({ deviceId: 'x', name: 'Some Watch' })).toBe(false)
  })
})

describe('Jumper', () => {
  it('parses a 4-byte frame and scales perfusion index', () => {
    const m = jumperAdapter.parse(frame(0x81, 72, 98, 55))
    expect(m?.heartRate).toBe(72)
    expect(m?.spo2).toBe(98)
    expect(m?.perfusionIndex).toBeCloseTo(5.5)
  })

  it('rejects a frame without the 0x81 leader', () => {
    expect(jumperAdapter.parse(frame(0x80, 72, 98, 55))).toBeNull()
  })
})

describe('generic FFE0', () => {
  const pad = (...head: number[]) => frame(...head, ...new Array(20 - head.length).fill(0))

  it('parses saturation, pulse and a split perfusion index', () => {
    // PI 4.50 => 450 => low 7 bits 66, high 3
    const m = ffe0Adapter.parse(pad(0xff, 0x44, 0x00, 0x00, 98, 72, 66, 3))
    expect(m?.spo2).toBe(98)
    expect(m?.heartRate).toBe(72)
    expect(m?.perfusionIndex).toBeCloseTo(4.5)
  })

  it('treats 0xFF as the no-data sentinel', () => {
    expect(ffe0Adapter.parse(pad(0xff, 0x44, 0, 0, 0xff, 72))?.sensorContact).toBe(false)
  })

  it('rejects an impossible saturation', () => {
    expect(ffe0Adapter.parse(pad(0xff, 0x44, 0, 0, 101, 72))?.sensorContact).toBe(false)
  })

  it('rejects a frame of the wrong length', () => {
    expect(ffe0Adapter.parse(frame(0xff, 0x44, 0, 0, 98, 72))).toBeNull()
  })
})

describe('ChoiceMMed', () => {
  it('parses a complete 13-byte frame', () => {
    const m = choiceMMedAdapter.parse(
      frame(0x3e, 98, 0, 72, 0, 14, 0, 0, 0, 0, 0, 75, 0xf0),
    )
    expect(m?.spo2).toBe(98)
    expect(m?.heartRate).toBe(72)
    expect(m?.respiratoryRate).toBe(14)
    expect(m?.perfusionIndex).toBeCloseTo(7.5)
  })

  it('recognizes the idle frame as no contact', () => {
    const m = choiceMMedAdapter.parse(frame(0x3e, 0, 0, 0, 0, 0, 0, 0, 0x20, 0, 0, 0, 0))
    expect(m?.sensorContact).toBe(false)
  })
})

describe('Viatom / Wellue', () => {
  /** Build a frame and append the CRC-8 the parser expects. */
  function viatomFrame(type: number, spo2: number, pulse: number): DataView {
    const body = [0xaa, 0x55, 0x00, 0x04, 0x00, type, spo2, pulse]
    let crc = 0
    for (const byte of body) {
      crc ^= byte
      for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >> 1) ^ 0x8c : crc >> 1
    }
    return frame(...body, crc)
  }

  it('parses a checksummed vitals frame', () => {
    const m = viatomAdapter.parse(viatomFrame(0x01, 98, 72))
    expect(m?.spo2).toBe(98)
    expect(m?.heartRate).toBe(72)
  })

  it('rejects a frame whose checksum does not match', () => {
    const good = viatomFrame(0x01, 98, 72)
    const bytes = new Uint8Array(good.buffer.slice(0))
    bytes[8] = bytes[8] ^ 0xff
    expect(viatomAdapter.parse(new DataView(bytes.buffer))).toBeNull()
  })

  it('ignores non-vitals packet types', () => {
    // type 2 is battery/status, not a reading
    expect(viatomAdapter.parse(viatomFrame(0x02, 98, 72))).toBeNull()
  })
})

describe('registry resolution', () => {
  it('prefers the standard profiles over vendor adapters', () => {
    expect(resolveAdapter({ deviceId: 'a', serviceUUIDs: [HEART_RATE_SERVICE] })?.id).toBe('ble_hr')
    expect(resolveAdapter({ deviceId: 'b', serviceUUIDs: [PLX_SERVICE] })?.id).toBe('ble_plx')
  })

  it('routes vendor services to their adapter', () => {
    expect(resolveAdapter({ deviceId: 'c', serviceUUIDs: [ISSC_SERVICE] })?.id).toBe('ble_bci')
    expect(resolveAdapter({ deviceId: 'd', serviceUUIDs: [FFE0_SERVICE] })?.id).toBe('ble_ffe0')
  })

  it('returns null for a device it does not recognize', () => {
    expect(resolveAdapter({ deviceId: 'e', serviceUUIDs: [] })).toBeNull()
    expect(resolveAdapter({ deviceId: 'f', name: 'Random Speaker' })).toBeNull()
  })
})
