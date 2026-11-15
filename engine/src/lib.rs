//! OSC-8 audio engine. Compiled to `wasm32-unknown-unknown` and driven from an
//! AudioWorklet through the raw C ABI below (see `src/engine/protocol.ts`).
//! The module has no imports; the host reads output from the exported `memory`.

pub mod drums;
pub mod dsp;
pub mod engine;
pub mod envelope;
pub mod fx;
pub mod instrument;
pub mod modulation;
pub mod params;
pub mod sequencer;
pub mod synth;
pub mod wavetable;

use core::cell::UnsafeCell;
use engine::Engine;

/// The single engine instance. The AudioWorklet is single-threaded, so plain
/// interior mutability is sound as long as the ABI is only called from it.
struct Global(UnsafeCell<Option<Engine>>);
unsafe impl Sync for Global {}
static ENGINE: Global = Global(UnsafeCell::new(None));
static SILENCE: [f32; engine::MAX_BLOCK] = [0.0; engine::MAX_BLOCK];

#[inline]
fn engine() -> Option<&'static mut Engine> {
    // SAFETY: single-threaded host (see `Global`); no references outlive a call.
    unsafe { (*ENGINE.0.get()).as_mut() }
}

fn midi(note: u32) -> u8 {
    note.min(127) as u8
}

/// (Re)create the engine at `sample_rate`. Builds the wavetables.
#[no_mangle]
pub extern "C" fn init(sample_rate: f32) {
    let sr = if sample_rate.is_finite() && sample_rate >= 8000.0 { sample_rate } else { 48000.0 };
    // SAFETY: see `engine()`.
    unsafe { *ENGINE.0.get() = Some(Engine::new(sr)) };
}

#[no_mangle]
pub extern "C" fn set_param(id: u32, value: f32) {
    if let Some(e) = engine() {
        e.set_param(id, value);
    }
}

#[no_mangle]
pub extern "C" fn note_on(note: u32, velocity: f32) {
    if let Some(e) = engine() {
        e.note_on(midi(note), velocity);
    }
}

#[no_mangle]
pub extern "C" fn note_off(note: u32) {
    if let Some(e) = engine() {
        e.note_off(midi(note));
    }
}

#[no_mangle]
pub extern "C" fn set_transport(playing: u32, bpm: f32) {
    if let Some(e) = engine() {
        e.set_transport(playing != 0, bpm);
    }
}

#[no_mangle]
pub extern "C" fn pattern_clear(steps: u32) {
    if let Some(e) = engine() {
        e.sequencer.pattern_clear(steps);
    }
}

#[no_mangle]
pub extern "C" fn pattern_add(step: u32, note: u32, length: u32, velocity: f32) {
    if let Some(e) = engine() {
        e.sequencer.pattern_add(step, note, length, velocity);
    }
}

/// Render `frames` (<= 128) samples into the output buffers.
#[no_mangle]
pub extern "C" fn process(frames: u32) {
    if let Some(e) = engine() {
        e.process(frames as usize);
    }
}

#[no_mangle]
pub extern "C" fn out_left() -> *const f32 {
    match engine() {
        Some(e) => e.out_left.as_ptr(),
        None => SILENCE.as_ptr(),
    }
}

#[no_mangle]
pub extern "C" fn out_right() -> *const f32 {
    match engine() {
        Some(e) => e.out_right.as_ptr(),
        None => SILENCE.as_ptr(),
    }
}

#[no_mangle]
pub extern "C" fn current_step() -> i32 {
    // The absolute 16th-note tick since play started (wrapped only at i32 range), so the
    // synth and drum views can each wrap it to their own pattern length.
    engine().map(|e| (e.sequencer.current_tick() % i32::MAX as i64) as i32).unwrap_or(-1)
}

/// Mod wheel, 0..1 (a modulation source; no MIDI CC input yet).
#[no_mangle]
pub extern "C" fn set_modwheel(value: f32) {
    if let Some(e) = engine() {
        e.set_modwheel(value);
    }
}

/// 1 while any modulation route is live (valid source + target, amount != 0).
#[no_mangle]
pub extern "C" fn mod_active() -> u32 {
    engine().map(|e| e.mod_active() as u32).unwrap_or(0)
}

/// Pointer to `PARAM_COUNT` (172) f32, indexed by param ID: the current effective
/// value of each param (knob value plus modulation from the most recent note,
/// clamped). Params that aren't mod targets hold their knob value.
#[no_mangle]
pub extern "C" fn mod_values_ptr() -> *const f32 {
    static NO_VALUES: [f32; params::PARAM_COUNT as usize] = [0.0; params::PARAM_COUNT as usize];
    match engine() {
        Some(e) => e.mod_values.as_ptr(),
        None => NO_VALUES.as_ptr(),
    }
}

/// Clear the drum pattern and set its length in steps.
#[no_mangle]
pub extern "C" fn drum_pattern_clear(steps: u32) {
    if let Some(e) = engine() {
        e.drums.pattern_clear(steps);
    }
}

/// Add a drum hit: step, voice (DRUM_VOICES index), velocity 0..1, accent 0/1.
#[no_mangle]
pub extern "C" fn drum_pattern_add(step: u32, voice: u32, velocity: f32, accent: u32) {
    if let Some(e) = engine() {
        e.drums.pattern_add(step, voice, velocity, accent != 0);
    }
}

/// Audition one drum voice now, regardless of transport.
#[no_mangle]
pub extern "C" fn drum_trigger(voice: u32, velocity: f32) {
    if let Some(e) = engine() {
        e.drum_trigger(voice as usize, velocity);
    }
}
