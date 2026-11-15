import { describe, expect, it } from "vitest"
import { smf as build, notesTrack, tempo, track, trackName } from "./build-smf"
import { chooseShift, contentBars, convert, defaultSelection, describe as describeImport, fold, quantize, tempoToBpm } from "./convert"
import { MidiParseError, parseSmf } from "./smf"

const PPQ = 96 // a 16th = 24 ticks

describe("parseSmf", () => {
  it("reads a format 1 file: tempo, names, running status, note-on velocity 0 as off", () => {
    const conductor = track([
      [0, ...trackName("Conductor")],
      [0, ...tempo(125)],
      [0, 0xff, 0x58, 0x04, 0x03, 0x02, 0x18, 0x08],
    ])
    const lead = track([
      [0, ...trackName("Lead")],
      [0, 0x91, 60, 100], // note on ch2
      [0, 64, 90], // running status: another note on
      [48, 60, 0], // running status, velocity 0: C off at 48
      [24, 0x81, 64, 40], // explicit note off for E at 72
      [0, 0xf0, 0x03, 0x01, 0x02, 0xf7], // sysex, skipped
      [24, 0xc1, 5], // program change: one data byte
      [0, 0x91, 67, 127],
      [96, 0x91, 67, 0],
    ])
    const midi = parseSmf(build(1, PPQ, [conductor, lead]))
    expect(midi.format).toBe(1)
    expect(midi.ppq).toBe(PPQ)
    expect(midi.tempo).toBe(480000)
    expect(midi.bpm).toBeCloseTo(125, 5)
    expect(midi.timeSignature).toEqual([3, 4])
    expect(midi.tracks.map((t) => t.name)).toEqual(["Conductor", "Lead"])
    expect(midi.tracks[1].channels).toEqual([1])
    expect(midi.tracks[1].notes).toEqual([
      { tick: 0, durationTicks: 48, note: 60, velocity: 100, channel: 1 },
      { tick: 0, durationTicks: 72, note: 64, velocity: 90, channel: 1 },
      { tick: 96, durationTicks: 96, note: 67, velocity: 127, channel: 1 },
    ])
  })

  it("reads format 0 and closes notes left open at the end of the track", () => {
    const midi = parseSmf(build(0, PPQ, [track([[0, 0x99, 36, 120], [48, 0x89, 36, 0], [0, 0x90, 48, 80], [96, 0xff, 0x01, 0x00]])]))
    expect(midi.bpm).toBeNull()
    expect(midi.tracks[0].notes).toEqual([
      { tick: 0, durationTicks: 48, note: 36, velocity: 120, channel: 9 },
      { tick: 48, durationTicks: 96, note: 48, velocity: 80, channel: 0 },
    ])
  })

  it("rejects malformed files with readable errors", () => {
    expect(() => parseSmf(new Uint8Array([1, 2, 3]))).toThrow(MidiParseError)
    expect(() => parseSmf(new TextEncoder().encode("RIFF0000WAVEfmt nonsense"))).toThrow(/isn't a Standard MIDI File/)
    const ok = build(1, PPQ, [track([[0, 0x90, 60, 100]])])
    expect(() => parseSmf(ok.slice(0, ok.length - 6))).toThrow(/truncated/)
    expect(() => parseSmf(build(1, 0xe250, [track([])]))).toThrow(/SMPTE/)
    // Data byte with no status before it.
    expect(() => parseSmf(build(0, PPQ, [track([[0, 60, 100]])]))).toThrow(/without a status byte/)
  })
})

describe("convert", () => {
  it("quantizes ticks to 16th steps (ppq/4), lengths at least one step", () => {
    expect(quantize([{ tick: 25, durationTicks: 5, note: 60, velocity: 100, channel: 0 }, { tick: 47, durationTicks: 70, note: 62, velocity: 100, channel: 0 }], PPQ)).toEqual([
      { step: 1, length: 1, note: 60, velocity: 100, channel: 0 },
      { step: 2, length: 3, note: 62, velocity: 100, channel: 0 },
    ])
  })

  it("picks the octave shift that fits the most notes, and folds the rest", () => {
    // A bass line around E1..A1 (28..33): two octaves down from the roll.
    expect(chooseShift([{ note: 28 }, { note: 31 }, { note: 33 }])).toBe(24)
    expect(chooseShift([{ note: 60 }, { note: 64 }])).toBe(0)
    expect(chooseShift([{ note: 84 }, { note: 88 }, { note: 91 }])).toBe(-24)
    expect(fold(40)).toBe(52)
    expect(fold(80)).toBe(68)
    expect(fold(72)).toBe(72)
  })

  it("converts a bass line: shift +24, osc A octave -2, one note folded", () => {
    const file = parseSmf(build(1, PPQ, [notesTrack("Bass", 0, [[0, 24, 28, 100], [48, 48, 31, 127], [96, 24, 33, 64], [144, 24, 52, 90]])]))
    const r = convert(file, { melodicTracks: [0], drumTracks: [] })
    expect(r.shift).toBe(24)
    expect(r.octave).toBe(-2)
    expect(r.bars).toBe(1)
    expect(r.pattern!.notes).toEqual([
      { step: 0, note: 52, length: 1, velocity: 0.787 },
      { step: 2, note: 55, length: 2, velocity: 1 },
      { step: 4, note: 57, length: 1, velocity: 0.504 },
      // 52 + 24 = 76 is above C5: folded down to 64.
      { step: 6, note: 64, length: 1, velocity: 0.709 },
    ])
    expect(r.folded).toBe(1)
    expect(describeImport(r)).toBe("1 bar (16 steps) from bar 1, 4 notes, shifted +24, osc A octave -2, 1 folded into range")
  })

  it("maps General MIDI drums to the 808, accents at velocity >= 110, ignores unknown notes", () => {
    const file = parseSmf(
      build(1, PPQ, [
        notesTrack("Drums", 9, [[0, 12, 36, 127], [0, 12, 42, 80], [96, 12, 38, 100], [96, 12, 39, 90], [48, 12, 46, 70], [144, 12, 49, 112], [144, 12, 81, 100], [24, 12, 56, 64]]),
      ])
    )
    const r = convert(file, { melodicTracks: [], drumTracks: [0] })
    expect(r.pattern).toBeNull()
    expect(r.drums!.hits.map((h) => `${h.voice}@${h.step}${h.accent ? "!" : ""}`).sort()).toEqual(
      ["kick@0!", "closedHat@0", "snare@4", "clap@4", "openHat@2", "cymbal@6!", "cowbell@1"].sort()
    )
  })

  it("chooses the window: the first bar with notes, as many bars as fit (1/2/4/8), or what's asked", () => {
    const bar = 16 * 24
    // Notes in bars 3, 4 and 6 (0-based 2, 3, 5).
    const file = parseSmf(build(1, PPQ, [notesTrack("Keys", 0, [[2 * bar, 24, 60, 100], [3 * bar + 24, 24, 62, 100], [5 * bar, 24, 64, 100]])]))
    const auto = convert(file, { melodicTracks: [0], drumTracks: [] })
    expect(auto.startBar).toBe(2)
    expect(auto.bars).toBe(4)
    expect(auto.pattern!.notes.map((n) => n.step)).toEqual([0, 17, 48])
    const asked = convert(file, { melodicTracks: [0], drumTracks: [], startBar: 3, bars: 1 })
    expect(asked.steps).toBe(16)
    expect(asked.pattern!.notes.map((n) => n.step)).toEqual([1])
    expect(contentBars([])).toEqual({ firstBar: 0, barCount: 1 })
  })

  it("excludes channel 10 from melodic tracks and de-duplicates same step and pitch", () => {
    const file = parseSmf(build(1, PPQ, [notesTrack("Mixed", 0, [[0, 24, 60, 50], [0, 48, 60, 100]]), notesTrack("Kit", 9, [[0, 24, 36, 100]])]))
    const r = convert(file, { melodicTracks: [0, 1], drumTracks: [] })
    // The second note-on ends the first (a repeated note-on), then the loudest of the two cells is kept.
    expect(r.pattern!.notes).toEqual([{ step: 0, note: 60, length: 1, velocity: 0.787 }])
  })

  it("tempo doubles or halves into 60..200 BPM", () => {
    expect(tempoToBpm(125)).toBe(125)
    expect(tempoToBpm(240)).toBe(120)
    expect(tempoToBpm(45)).toBe(90)
    expect(tempoToBpm(0)).toBe(120)
  })

  it("preselects the busiest melodic track and every drum track", () => {
    const file = parseSmf(build(1, PPQ, [notesTrack("Pad", 0, [[0, 24, 60, 100]]), notesTrack("Lead", 1, [[0, 24, 60, 100], [24, 24, 62, 100]]), notesTrack("Kit", 9, [[0, 24, 36, 100]])]))
    expect(defaultSelection(file)).toEqual({ melodicTracks: [1], drumTracks: [2] })
  })
})
