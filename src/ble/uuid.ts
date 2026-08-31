/** Bluetooth SIG base UUID — 16- and 32-bit ids expand into this. */
const BASE_SUFFIX = '-0000-1000-8000-00805f9b34fb'

/** Expand a 16-bit assigned number (e.g. 0x180d) to its full 128-bit form. */
export function sig(id: number): string {
  return `0000${id.toString(16).padStart(4, '0')}${BASE_SUFFIX}`
}

/**
 * Normalize whatever form a platform hands back into full lowercase 128-bit.
 * Android reports full UUIDs; some stacks report the short form.
 */
export function normalize(uuid: string): string {
  const u = uuid.toLowerCase()
  if (/^[0-9a-f]{4}$/.test(u)) return `0000${u}${BASE_SUFFIX}`
  if (/^[0-9a-f]{8}$/.test(u)) return `${u}${BASE_SUFFIX}`
  return u
}

// --- Standard GATT: Heart Rate -------------------------------------------
export const HEART_RATE_SERVICE = sig(0x180d)
export const HEART_RATE_MEASUREMENT = sig(0x2a37)

// --- Standard GATT: Pulse Oximeter ---------------------------------------
export const PLX_SERVICE = sig(0x1822)
export const PLX_CONTINUOUS_MEASUREMENT = sig(0x2a5f)
export const PLX_SPOT_CHECK_MEASUREMENT = sig(0x2a5e)

// --- Vendor transports ----------------------------------------------------
/** Microchip/ISSC transparent UART — BerryMed and other BCI-protocol units */
export const ISSC_SERVICE = '49535343-fe7d-4ae5-8fa9-9fafd205e455'
export const ISSC_NOTIFY = '49535343-1e4d-4bd9-ba61-23c647249616'

/** Nordic UART Service */
export const NUS_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e'
export const NUS_NOTIFY = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'

/** HM-10 style serial bridge, common on generic fingertip oximeters */
export const FFE0_SERVICE = sig(0xffe0)
export const FFE0_NOTIFY = sig(0xffe1)
export const FFF0_SERVICE = sig(0xfff0)
export const FFF0_NOTIFY = sig(0xfff1)

/** Jumper */
export const JUMPER_SERVICE = 'cdeacb80-5235-4c07-8846-93a37ee6b86d'
export const JUMPER_NOTIFY = 'cdeacb81-5235-4c07-8846-93a37ee6b86d'

/** Viatom / Wellue — newer units advertise this, older ones fall back to NUS */
export const VIATOM_SERVICE = '14839ac4-7d7e-415c-9a42-167340cf2339'
export const VIATOM_NOTIFY = '8b00ace7-eb0b-49b0-bbe9-9aee0a26e1a3'

/** ChoiceMMed advertises this vanity UUID ("Choicemmed" in ASCII, reversed) */
export const CHOICEMMED_ADVERT = '00000001-0000-6465-6d6d-65636c6f6843'
