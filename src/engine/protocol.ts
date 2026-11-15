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

export type ToWorklet =
  | { type: "init"; wasm: ArrayBuffer }
  | { type: "params"; params: [id: number, value: number][] }
  | { type: "pattern"; pattern: Pattern }
  | { type: "transport"; playing: boolean; bpm: number }
  | { type: "noteOn"; note: number; velocity: number }
  | { type: "noteOff"; note: number }

export type FromWorklet =
  | { type: "ready" }
  | { type: "error"; message: string }
  /** Current sequencer step, sent when it changes. -1 when stopped. */
  | { type: "step"; step: number }

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
 The module has no imports. Memory is the exported `memory`.
*/
