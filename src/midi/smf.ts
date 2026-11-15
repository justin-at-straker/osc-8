// A small, dependency-free Standard MIDI File reader: formats 0 and 1 (2 is
// read the same way), running status, tempo / time-signature / track-name
// meta events, note on/off (note-on with velocity 0 is a note-off). Sysex and
// every other event are skipped safely. Malformed input throws MidiParseError
// with a readable message.

export class MidiParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "MidiParseError"
  }
}

export type SmfNote = {
  /** Start, in ticks from the start of the song. */
  tick: number
  durationTicks: number
  /** MIDI note number 0..127. */
  note: number
  /** 1..127. */
  velocity: number
  /** 0..15 (9 is the GM drum channel, "channel 10"). */
  channel: number
}

export type SmfTrack = {
  index: number
  name: string
  /** Channels with notes in this track, ascending. */
  channels: number[]
  notes: SmfNote[]
}

export type Smf = {
  format: number
  /** Ticks per quarter note. */
  ppq: number
  /** The first tempo, microseconds per quarter note; null if the file has none (120 BPM by the spec). */
  tempo: number | null
  /** The first tempo as BPM, or null. */
  bpm: number | null
  /** The first time signature, [numerator, denominator], or null. */
  timeSignature: [number, number] | null
  tracks: SmfTrack[]
}

/** Bytes for each channel message's data, by status high nibble. */
const DATA_BYTES: Record<number, number> = { 0x8: 2, 0x9: 2, 0xa: 2, 0xb: 2, 0xc: 1, 0xd: 1, 0xe: 2 }

class Reader {
  pos = 0
  readonly bytes: Uint8Array
  readonly end: number
  constructor(bytes: Uint8Array, end = bytes.length) {
    this.bytes = bytes
    this.end = end
  }
  need(n: number, what: string) {
    if (this.pos + n > this.end) throw new MidiParseError(`The file ends in the middle of ${what}; it may be truncated.`)
  }
  u8(what = "an event") {
    this.need(1, what)
    return this.bytes[this.pos++]
  }
  u16() {
    this.need(2, "the header")
    const v = (this.bytes[this.pos] << 8) | this.bytes[this.pos + 1]
    this.pos += 2
    return v
  }
  u32(what: string) {
    this.need(4, what)
    const b = this.bytes
    const v = ((b[this.pos] << 24) >>> 0) + (b[this.pos + 1] << 16) + (b[this.pos + 2] << 8) + b[this.pos + 3]
    this.pos += 4
    return v
  }
  ascii(n: number, what: string) {
    this.need(n, what)
    let s = ""
    for (let i = 0; i < n; i++) s += String.fromCharCode(this.bytes[this.pos + i])
    this.pos += n
    return s
  }
  /** A variable-length quantity: at most 4 bytes. */
  vlq(what: string) {
    let v = 0
    for (let i = 0; i < 4; i++) {
      const b = this.u8(what)
      v = (v << 7) | (b & 0x7f)
      if (!(b & 0x80)) return v
    }
    throw new MidiParseError(`A length or delta time in ${what} is malformed.`)
  }
}

export function parseSmf(input: ArrayBuffer | Uint8Array): Smf {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  if (bytes.length < 14) throw new MidiParseError("This file is too short to be a MIDI file.")
  const r = new Reader(bytes)
  if (r.ascii(4, "the header") !== "MThd") throw new MidiParseError("This isn't a Standard MIDI File (no MThd header).")
  const headerLength = r.u32("the header")
  if (headerLength < 6) throw new MidiParseError("The MIDI header is malformed.")
  const format = r.u16()
  const trackCount = r.u16()
  const division = r.u16()
  r.pos = 8 + headerLength
  if (format > 2) throw new MidiParseError(`Unknown MIDI file format ${format}.`)
  if (division & 0x8000) throw new MidiParseError("This file uses SMPTE timing, which isn't supported; save it with ticks per quarter note.")
  if (division === 0) throw new MidiParseError("The MIDI header has zero ticks per quarter note.")

  const song = { tempo: null as number | null, timeSignature: null as [number, number] | null }
  const tracks: SmfTrack[] = []
  while (r.pos + 8 <= bytes.length && tracks.length < trackCount) {
    const id = r.ascii(4, "a chunk header")
    const length = r.u32("a chunk header")
    const start = r.pos
    if (start + length > bytes.length) {
      if (id !== "MTrk") break
      throw new MidiParseError(`Track ${tracks.length + 1} is longer than the file; it may be truncated.`)
    }
    // Unknown chunks are skipped, as the spec asks.
    if (id === "MTrk") tracks.push(readTrack(new Reader(bytes, start + length), start, tracks.length, song))
    r.pos = start + length
  }
  if (tracks.length === 0) throw new MidiParseError("The file has no tracks.")
  return {
    format,
    ppq: division,
    tempo: song.tempo,
    bpm: song.tempo ? 60_000_000 / song.tempo : null,
    timeSignature: song.timeSignature,
    tracks,
  }
}

function readTrack(r: Reader, start: number, index: number, song: { tempo: number | null; timeSignature: [number, number] | null }): SmfTrack {
  r.pos = start
  const what = `track ${index + 1}`
  let tick = 0
  let running = 0
  let name = ""
  const notes: SmfNote[] = []
  // Open notes by channel*128+note, oldest first.
  const open = new Map<number, { tick: number; velocity: number }[]>()
  const close = (channel: number, note: number, at: number) => {
    const queue = open.get(channel * 128 + note)
    const on = queue?.shift()
    if (on) notes.push({ tick: on.tick, durationTicks: Math.max(0, at - on.tick), note, velocity: on.velocity, channel })
  }

  while (r.pos < r.end) {
    tick += r.vlq(what)
    let status = r.u8(what)
    if (status === 0xff) {
      const type = r.u8(what)
      const length = r.vlq(what)
      r.need(length, what)
      const data = r.bytes.subarray(r.pos, r.pos + length)
      r.pos += length
      if (type === 0x2f) break // end of track
      if (type === 0x03 && !name) name = new TextDecoder("latin1").decode(data).trim()
      if (type === 0x51 && length === 3 && song.tempo === null) song.tempo = (data[0] << 16) | (data[1] << 8) | data[2]
      if (type === 0x58 && length >= 2 && song.timeSignature === null) song.timeSignature = [data[0], 2 ** data[1]]
      continue
    }
    if (status === 0xf0 || status === 0xf7) {
      const length = r.vlq(what)
      r.need(length, what)
      r.pos += length
      continue
    }
    if (status >= 0xf1) {
      // System common/real-time bytes have no business in a file; skip their data if any.
      continue
    }
    let first: number
    if (status & 0x80) {
      running = status
      first = r.u8(what)
    } else {
      if (!running) throw new MidiParseError(`${what[0].toUpperCase()}${what.slice(1)} has data without a status byte.`)
      first = status
      status = running
    }
    const kind = status >> 4
    const channel = status & 0x0f
    const second = DATA_BYTES[kind] === 2 ? r.u8(what) : 0
    if (kind === 0x9 && second > 0) {
      const key = channel * 128 + (first & 0x7f)
      // A repeated note-on without an off ends the previous one.
      if (open.get(key)?.length) close(channel, first & 0x7f, tick)
      if (!open.has(key)) open.set(key, [])
      open.get(key)!.push({ tick, velocity: second & 0x7f })
    } else if (kind === 0x8 || kind === 0x9) {
      close(channel, first & 0x7f, tick)
    }
  }
  // Notes still sounding at the end of the track end there.
  for (const [key, queue] of open) for (const on of queue) notes.push({ tick: on.tick, durationTicks: Math.max(0, tick - on.tick), note: key % 128, velocity: on.velocity, channel: Math.floor(key / 128) })

  notes.sort((a, b) => a.tick - b.tick || a.note - b.note)
  return { index, name, channels: [...new Set(notes.map((n) => n.channel))].sort((a, b) => a - b), notes }
}
