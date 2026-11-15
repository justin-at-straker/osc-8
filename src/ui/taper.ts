// Knob tapers: how a knob's travel (0..1) maps onto a parameter's range.
// Linear for levels, logarithmic for frequencies, a power curve for times
// so the short end gets most of the travel.
export type Taper = { kind: "linear" } | { kind: "log" } | { kind: "power"; exponent: number }

export const LINEAR: Taper = { kind: "linear" }
export const LOG: Taper = { kind: "log" }
export const power = (exponent: number): Taper => ({ kind: "power", exponent })

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

/** Parameter value to knob travel, 0..1. */
export function toTravel(value: number, min: number, max: number, taper: Taper): number {
  if (max === min) return 0
  switch (taper.kind) {
    case "log":
      return clamp01(Math.log(Math.max(value, min) / min) / Math.log(max / min))
    case "power":
      return clamp01(((value - min) / (max - min)) ** (1 / taper.exponent))
    default:
      return clamp01((value - min) / (max - min))
  }
}

/** Knob travel, 0..1, to parameter value. */
export function fromTravel(travel: number, min: number, max: number, taper: Taper): number {
  const t = clamp01(travel)
  switch (taper.kind) {
    case "log":
      return min * (max / min) ** t
    case "power":
      return min + (max - min) * t ** taper.exponent
    default:
      return min + (max - min) * t
  }
}

/** Round to a step measured from min, and clamp, so the store's schema always accepts it. */
export function snap(value: number, min: number, max: number, step?: number): number {
  const stepped = step ? min + Math.round((value - min) / step) * step : value
  // Trim float noise from the step arithmetic.
  return Math.min(max, Math.max(min, Number(stepped.toPrecision(10))))
}

/** "+3.0dB", "0.0dB", "-12.0dB". */
export const formatDb = (db: number) => `${db > 0 ? "+" : db < 0 ? "-" : ""}${Math.abs(db).toFixed(1)}dB`
/** "0.25Hz", "1.6Hz", "10Hz". */
export const formatRate = (hz: number) => `${hz < 1 ? hz.toFixed(2) : hz < 10 ? hz.toFixed(1) : Math.round(hz)}Hz`
