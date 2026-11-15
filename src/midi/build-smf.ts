// Builds Standard MIDI File bytes, for tests (and handy for fixtures).

export const vlq = (value: number): number[] => {
  const out = [value & 0x7f]
  let v = value >> 7
  while (v > 0) {
    out.unshift((v & 0x7f) | 0x80)
    v >>= 7
  }
  return out
}

const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
const u16 = (n: number) => [(n >> 8) & 0xff, n & 0xff]
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0))

/** A track's events as [delta ticks, ...event bytes]; an end-of-track is appended. Bytes are written as given, so running status is up to the caller. */
export function track(events: [number, ...number[]][]): number[] {
  const body = events.flatMap(([delta, ...bytes]) => [...vlq(delta), ...bytes])
  body.push(0x00, 0xff, 0x2f, 0x00)
  return [...ascii("MTrk"), ...u32(body.length), ...body]
}

export function smf(format: number, ppq: number, tracks: number[][]): Uint8Array {
  return new Uint8Array([...ascii("MThd"), ...u32(6), ...u16(format), ...u16(tracks.length), ...u16(ppq), ...tracks.flat()])
}

/** Meta events. */
export const tempo = (bpm: number): number[] => {
  const us = Math.round(60_000_000 / bpm)
  return [0xff, 0x51, 0x03, (us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff]
}
export const trackName = (name: string): number[] => [0xff, 0x03, ...vlq(name.length), ...ascii(name)]

/** Simple note helpers: a list of [startTick, lengthTicks, note, velocity] on a channel, as a track. */
export function notesTrack(name: string, channel: number, notes: [number, number, number, number][]): number[] {
  const events: { at: number; bytes: number[] }[] = []
  for (const [at, len, note, vel] of notes) {
    events.push({ at, bytes: [0x90 | channel, note, vel] })
    events.push({ at: at + len, bytes: [0x80 | channel, note, 0] })
  }
  events.sort((a, b) => a.at - b.at || (a.bytes[0] & 0xf0) - (b.bytes[0] & 0xf0))
  let now = 0
  const out: [number, ...number[]][] = [[0, ...trackName(name)]]
  for (const e of events) {
    out.push([e.at - now, ...e.bytes])
    now = e.at
  }
  return track(out)
}
