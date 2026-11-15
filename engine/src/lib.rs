//! OSC-8 audio engine. Compiled to `wasm32-unknown-unknown` and driven from an
//! AudioWorklet through the raw C ABI below (see `src/engine/protocol.ts`).
//! The module has no imports; the host reads output from the exported `memory`.

pub mod engine;
pub mod instrument;
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
    engine().map(|e| e.sequencer.current_step()).unwrap_or(-1)
}
