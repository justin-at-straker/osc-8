// Messages between the main thread (EngineClient) and the AudioWorklet.
// The worklet owns the WASM instance; the main thread never calls WASM directly.

export type Note = {
  /** Start step, 0..steps-1 (16th notes). */
  step: number
  /** MIDI note number. */
  note: number
  /** Length in steps, >= 1. */
  length: number
  /** Velocity 0..1. */
  velocity: number
}

export type Pattern = { steps: number; notes: Note[] }

export type { DrumPattern } from "./drums"
import type { DrumPattern } from "./drums"

export type ToWorklet =
  | { type: "init"; wasm: ArrayBuffer }
  | { type: "params"; params: [id: number, value: number][] }
  | { type: "pattern"; pattern: Pattern }
  | { type: "transport"; playing: boolean; bpm: number }
  | { type: "noteOn"; note: number; velocity: number }
  | { type: "noteOff"; note: number }
  | { type: "modwheel"; value: number }
  /** The 808 track's pattern (replaces it). Kit params travel in "params" with IDs 1000+ (drums.ts). */
  | { type: "drumPattern"; pattern: DrumPattern }
  /** Audition one drum voice now (grid clicks, pads). voice = index into DRUM_VOICES. */
  | { type: "drumTrigger"; voice: number; velocity: number }

export type FromWorklet =
  | { type: "ready" }
  | { type: "error"; message: string }
  /** Current sequencer step, sent when it changes. -1 when stopped. */
  | { type: "step"; step: number }
  /** ~30 Hz while any mod route is live, then once with active false. values[paramId] for IDs 0..38, engineering units. */
  | { type: "mod"; active: boolean; values: Float32Array }

/*
 WASM ABI (engine/src/lib.rs, all `#[no_mangle] extern "C"`):
   init(sample_rate: f32)
   set_param(id: u32, value: f32)
   note_on(note: u32, velocity: f32)
   note_off(note: u32)
   set_transport(playing: u32, bpm: f32)
   pattern_clear(steps: u32)
   pattern_add(step: u32, note: u32, length: u32, velocity: f32)
   process(frames: u32)            // renders `frames` (<= 128) samples
   out_left() -> *const f32        // pointer into WASM memory, 128 floats
   out_right() -> *const f32
   current_step() -> i32           // -1 when stopped
   set_modwheel(value: f32)        // 0..1
   mod_active() -> u32             // 1 while any mod route is live
   mod_values_ptr() -> *const f32  // effective (modulated) value per param ID (length: see engine report)
   drum_pattern_clear(steps: u32)
   drum_pattern_add(step: u32, voice: u32, velocity: f32, accent: u32)
   drum_trigger(voice: u32, velocity: f32)
   set_param ids 1000+ are drum kit params (drums.ts kitToParams); unknown ids are ignored.
 The module has no imports. Memory is the exported `memory`.
*/
