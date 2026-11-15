# OSC-8

A browser groovebox: a Serum-style wavetable synth and an 808-style drum machine, with AI that designs sounds and writes music. Built on the [SPEC-01](https://spec-01.vercel.app) hardware kit for the Vercel UI SDK.

**Live:** https://osc-8.vercel.app

## What it does

- **Wavetable synth:** two oscillators with up to 16-voice unison (detune, blend, stereo spread), sub, noise, a 24 dB low-pass filter, three envelopes, four LFOs and a 16-slot mod matrix. Drag an LFO or envelope handle onto any knob to modulate it.
- **FX chain:** distortion (5 types), chorus, tempo-synced ping-pong delay, reverb, OTT-style multiband compression, EQ.
- **808-style drum machine:** 11 synthesized voices with swing and accent, on its own track.
- **Patterns** of 1 to 8 bars for each track, with a piano roll and a step grid.
- **AI:** describe a sound or a groove ("a wobble bass at 1/8 with a dark minor bassline") and it edits the patch, writes the notes and programs the drums. It can also turn the knobs you see on screen through the UI SDK agent tools. Everything it does is one undo step.
- **MIDI import**, patch import/export, 23 factory presets, and a saved startup session.

## Bring your own key

OSC-8 has no server. The AI runs in your browser and calls OpenAI directly with **your own API key**, which is stored only in your browser and sent only to OpenAI. Usage is billed to your OpenAI account. Add a key from the **Key** button next to the describe field, or **AI > API key...**.

## How it's built

```
React UI (SPEC-01 / UI SDK)  ->  store (patch, patterns, drums, undo)  ->  AudioWorklet  ->  osc8.wasm (Rust)
                       AI (AI SDK, in the browser)  --^
```

- `engine/`: the audio engine in Rust, compiled to `wasm32-unknown-unknown` with a raw C ABI (no wasm-bindgen). The sequencer clock runs inside the engine for sample-accurate timing.
- `src/engine/`: the patch schema (`patch.ts`), the parameter IDs shared with Rust (`params.ts`), the worklet and its client.
- `src/ui/`: the instrument UI. `src/ai/`: the sound and music agent. `src/midi/`: the MIDI file importer.
- `PLAN.md`: the design decisions and milestones.

## Develop

Requires Node 22+, pnpm, and Rust with the `wasm32-unknown-unknown` target (only to change the engine).

```sh
pnpm install
pnpm dev            # http://localhost:5173
pnpm test           # vitest
pnpm test:rust      # cargo tests for the engine
pnpm build:wasm     # rebuild src/engine/osc8.wasm after engine changes
pnpm build          # wasm + typecheck + production build
```

For local AI development you can put `OPENAI_API_KEY=...` in `.env.local`. It is injected only while running `pnpm dev` and is never included in a production build.

`src/engine/osc8.wasm` is checked in because Vercel's build image has no Rust; Vercel runs `pnpm build:web`.

## License

MIT
