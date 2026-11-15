# OSC-8 Plan

A browser groovebox with a Serum-shaped wavetable synth and AI sound design, built on the SPEC-01 hardware kit (Vercel UI SDK).

## Decisions

| # | Topic | Decision |
|---|---|---|
| 1 | Scope | Groovebox: 8 tracks, pattern piano roll per track, pattern chaining into a song, mixer, WAV export. Designed to grow toward a linear arrangement later (song mode stores pattern references). |
| 2 | Platform | Browser app, deployed on Vercel. |
| 3 | DSP | Rust compiled to `wasm32-unknown-unknown`, run inside an `AudioWorklet`. Raw `extern "C"` exports, no wasm-bindgen. |
| 4 | Synth (v1) | See "Synth spec" below. Wavetables: built-in generated library, `.wav` import, and formula/harmonic-spectrum tables (AI-authorable). |
| 5 | AI control | Both: patch-level tools (`setPatch`, `generateWavetable`, ...) for new sounds, and UI SDK `agent` (`snapshot`/`query`/`act`) for tweaking visible controls. One patch store, one undo history. |
| 6 | Framework | Vite + React static SPA. No server code. |
| 7 | Instruments | Wavetable synth + drum sampler (16 pads, step grid). Both implement an `Instrument` trait; new instrument types plug in without touching sequencer/mixer/AI. |
| 8 | Storage | Local-first IndexedDB. Projects export/import as `.zip` (JSON + samples). Every entity has a stable ID and a schema version so cloud sync can be added later. |
| 9 | Audience | Public product. |
| 10 | AI cost | BYOK only. No accounts. |
| 11 | Key routing | Browser-direct: AI SDK runs in the browser, key stored in IndexedDB, never touches our infrastructure. Providers: Anthropic, OpenAI, OpenRouter. Strict CSP, no third-party scripts. |
| 12 | AI UX | Contextual describe field on each instrument plus "variations" (generate 4, audition, keep one), and a global assistant on `Ctrl+K`. |
| 13 | Devices | Desktop only (>= 1280px). QWERTY note input, Web MIDI optional. Panels built with `resizable`/`device` so tablet is possible later. |
| 14 | Repo | `~/projects/osc-8`, local git, public later (account TBD before first push). |
| 16 | License | MIT. |
| 17 | Testing | Rust unit tests + golden-render tests (`cargo test`, native). Vitest for schema/tool validation. Playwright smoke test: app loads, worklet produces non-silent audio. |
| 18 | Key color | SPEC-01 default orange-red `{ l: 0.64, c: 0.31, h: 48 }`. |
| 19 | Default model | Latest Claude Sonnet; model picker per provider. |
| 20 | Sharing | Patches export/import as `.osc8.json`. |

The UI kit: SPEC-01 shadcn registry at `https://spec-01.vercel.app/r/registry.json`, app wrapped in `<Hardware>` from `components/ui/hardware`. Components are skins over `@ui-sdk/react`, pinned to the exact snapshot the registry uses (`0.0.0-20261111125312.ga16c1d57`). Do not float it.

## Architecture

```
React UI (SPEC-01 / UI SDK)          AI (browser, AI SDK, BYOK)
   |   knob edits                       |  patch tools      | UI SDK act
   v                                    v                   v
 Patch store (zod-validated, undo) <----+-------------------+
   |   postMessage (protocol.ts)
   v
 AudioWorklet (worklet.ts)  -- loads --> osc8.wasm (Rust engine)
   - sequencer clock (sample-accurate, in WASM)
   - Instrument trait: WavetableSynth, DrumSampler
   - mixer, FX
```

- **Engine owns time.** The sequencer runs in WASM. The UI sends edits and reads back the playhead.
- **Patch schema is the contract** between knobs, AI, presets and the engine. Defined once in `src/engine/patch.ts` (zod), mirrored as flat parameter IDs the engine understands.
- **Parameters cross the boundary as `(paramId, value)`** with normalized or engineering units defined in the schema, so knobs, AI tools and the mod matrix all address the same IDs.

## Synth spec (v1)

| Section | v1 |
|---|---|
| Oscillators | 2 wavetable oscs (position, unison up to 16 with detune/blend/spread, octave/semi/fine, phase/random) + sub + noise |
| Warp | One warp mode per osc: sync, bend, PWM, FM-from-B, mirror |
| Filter | 1 filter: LP/HP/BP 12/24, notch, comb; cutoff, res, drive, mix; per-osc routing |
| Mod sources | 3 envelopes, 4 LFOs (shape presets, sync, one-shot), velocity, mod wheel, note, random |
| Mod matrix | 16 slots: source -> any parameter, bipolar amount, aux source |
| FX | Distortion, chorus, delay, reverb, OTT-style multiband compressor, EQ |
| Voicing | Poly/mono, legato, glide, voice count |

Out of v1: drawn LFOs, second filter, wavetable editor UI.

## Milestones

- **M1 "first sound"** (vertical slice through every layer)
  1. Vite + React + `<Hardware>`, SPEC-01 installed, `@ui-sdk/react` pinned
  2. Rust crate -> WASM -> AudioWorklet, "tap to start audio"
  3. One synth track: 1 wavetable osc (built-in tables) + 1 LP filter + amp envelope. Full patch schema defined, partly wired.
  4. Sequencer clock in WASM; piano roll (adapted from SPEC-01 `midi-editor`) driving one 16-step pattern; tempo/play on an LCD transport
  5. BYOK settings (Anthropic first) + describe field -> `setPatch` -> audible
  6. UI SDK `act`: "brighter" turns the real cutoff knob
- **M2** Full synth: 2 oscs, unison, warp, sub/noise, mod matrix, LFOs/envelopes, FX, formula wavetables
- **M3** Drum sampler + step grid, 8 tracks, pattern banks
- **M4** Mixer, song mode, project `.zip`, WAV export, IndexedDB persistence
- **M5** Global assistant, variations, OpenAI + OpenRouter, polish, CSP, Playwright smoke test
