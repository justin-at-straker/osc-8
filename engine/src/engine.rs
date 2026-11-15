//! `Engine`: the sequencer plus one track's instrument, rendering fixed blocks
//! into output buffers the host reads from WASM memory.
//!
//! Signal path: instrument -> master FX chain (stereo) -> master volume -> tanh soft clip.
//!
//! Global modulation (master volume, FX params) comes from the instrument's
//! "most recent note" mod context and is applied once per block; the FX's own
//! parameter smoothers (and the master volume smoother) make it continuous.

use crate::dsp::Smoother;
use crate::fx::FxChain;
use crate::instrument::Instrument;
use crate::modulation::{self, TARGET_SLOTS};
use crate::params::*;
use crate::sequencer::Sequencer;
use crate::synth::WavetableSynth;

/// Largest block `process` renders (one Web Audio render quantum).
pub const MAX_BLOCK: usize = 128;

/// Base (knob) values of params 0..38 for the default patch (`defaultPatch()` in patch.ts).
pub const DEFAULT_BASE: [f32; TARGET_SLOTS] = [
    0.0, 0.0, 0.75, 0.0, 0.0, 0.0, 4000.0, 0.2, 1.0, 0.005, 0.3, 0.7, 0.25, 0.7, // synth + master
    0.0, 0.0, 0.3, 1.0, // distortion
    0.0, 0.8, 0.4, 0.4, // chorus
    0.0, 2.0, 0.35, 0.25, 1.0, // delay
    0.0, 0.6, 0.5, 0.5, 0.25, // reverb
    0.0, 0.5, 0.5, // ott
    0.0, 0.0, 0.0, 0.0, // eq
];

pub struct Engine {
    pub sequencer: Sequencer,
    pub track: Box<dyn Instrument>,
    pub fx: FxChain,
    pub out_left: [f32; MAX_BLOCK],
    pub out_right: [f32; MAX_BLOCK],
    /// Knob values of params 0..38 as last set.
    base: [f32; TARGET_SLOTS],
    /// Current effective (modulated) value of params 0..38, for UI readback.
    pub mod_values: [f32; TARGET_SLOTS],
    /// FX params that were modulated last block (restored to base when a route goes away).
    fx_modulated: [bool; TARGET_SLOTS],
    volume: Smoother,
}

impl Engine {
    pub fn new(sample_rate: f32) -> Self {
        Self::with_instrument(sample_rate, Box::new(WavetableSynth::new(sample_rate)))
    }

    pub fn with_instrument(sample_rate: f32, track: Box<dyn Instrument>) -> Self {
        Self {
            sequencer: Sequencer::new(sample_rate),
            track,
            fx: FxChain::new(sample_rate),
            out_left: [0.0; MAX_BLOCK],
            out_right: [0.0; MAX_BLOCK],
            base: DEFAULT_BASE,
            mod_values: DEFAULT_BASE,
            fx_modulated: [false; TARGET_SLOTS],
            volume: Smoother::with_time(DEFAULT_BASE[MASTER_VOLUME as usize], 0.01, sample_rate),
        }
    }

    pub fn set_param(&mut self, id: u32, value: f32) {
        if !value.is_finite() {
            return;
        }
        if (id as usize) < TARGET_SLOTS {
            self.base[id as usize] = value;
            self.mod_values[id as usize] = value;
        }
        if id == MASTER_VOLUME {
            self.volume.target = value.clamp(0.0, 1.0);
        } else if !self.fx.set_param(id, value) {
            self.track.set_param(id, value);
        }
    }

    pub fn set_modwheel(&mut self, value: f32) {
        self.track.set_modwheel(value);
    }

    /// Any live modulation route?
    pub fn mod_active(&self) -> bool {
        self.track.global_mod().map(|g| g.active).unwrap_or(false)
    }

    /// Apply the instrument's global modulation to master volume and FX, and refresh `mod_values`.
    fn apply_global_mod(&mut self) {
        let Some(g) = self.track.global_mod() else { return };
        let g = *g;
        for t in modulation::TARGETS.iter() {
            let id = t.id as usize;
            let off = g.offsets[id];
            let value = modulation::apply_target(t, self.base[id], off);
            self.mod_values[id] = value;
            if t.id == MASTER_VOLUME {
                self.volume.target = value.clamp(0.0, 1.0);
            } else if t.id >= FX_FIRST && (off != 0.0 || self.fx_modulated[id]) {
                self.fx.set_param(t.id, value);
                self.fx_modulated[id] = off != 0.0;
            }
        }
    }

    pub fn note_on(&mut self, note: u8, velocity: f32) {
        self.track.note_on(note, velocity);
    }

    pub fn note_off(&mut self, note: u8) {
        self.track.note_off(note);
    }

    pub fn set_transport(&mut self, playing: bool, bpm: f32) {
        self.sequencer.set_transport(playing, bpm, &mut *self.track);
        self.fx.set_bpm(self.sequencer.bpm());
        self.track.set_bpm(self.sequencer.bpm());
    }

    /// Render `frames` (clamped to MAX_BLOCK) into `out_left`/`out_right`,
    /// splitting the block at sequencer events for sample accuracy.
    pub fn process(&mut self, frames: usize) {
        let frames = frames.min(MAX_BLOCK);
        let mut pos = 0;
        while pos < frames {
            let n = match self.sequencer.samples_until_event() {
                Some(0) => {
                    self.sequencer.fire(&mut *self.track);
                    continue;
                }
                Some(until) => until.min(frames - pos),
                None => frames - pos,
            };
            self.track.render(&mut self.out_left[pos..pos + n], &mut self.out_right[pos..pos + n]);
            self.sequencer.advance(n);
            pos += n;
        }
        // An event landing exactly on the block end fires now so current_step is up to date.
        if self.sequencer.samples_until_event() == Some(0) {
            self.sequencer.fire(&mut *self.track);
        }
        self.apply_global_mod();
        self.fx.process(&mut self.out_left[..frames], &mut self.out_right[..frames]);
        for i in 0..frames {
            let v = self.volume.next();
            self.out_left[i] = soft_clip(self.out_left[i] * v);
            self.out_right[i] = soft_clip(self.out_right[i] * v);
        }
    }
}

/// tanh soft clipper: transparent at low level, never exceeds +-1. NaN becomes silence.
#[inline]
pub fn soft_clip(x: f32) -> f32 {
    if x.is_nan() { 0.0 } else { x.tanh() }
}

/// Something to do at a given frame in an offline render.
#[derive(Clone, Copy, Debug)]
pub enum Event {
    Param(u32, f32),
    NoteOn(u8, f32),
    NoteOff(u8),
    Transport(bool, f32),
    Pattern { steps: u32 },
    PatternNote { step: u32, note: u32, length: u32, velocity: f32 },
}

/// Golden-render helper: render `frames` samples offline, applying `events`
/// (sorted by frame) at block granularity of `MAX_BLOCK` or at their exact frame.
pub fn render_offline(sample_rate: f32, events: &[(usize, Event)], frames: usize) -> (Vec<f32>, Vec<f32>) {
    let mut engine = Engine::new(sample_rate);
    let mut left = Vec::with_capacity(frames);
    let mut right = Vec::with_capacity(frames);
    let mut ev = 0;
    let mut pos = 0;
    while pos < frames {
        while ev < events.len() && events[ev].0 <= pos {
            apply(&mut engine, events[ev].1);
            ev += 1;
        }
        let next_event = events.get(ev).map(|e| e.0).unwrap_or(usize::MAX);
        let n = (frames - pos).min(MAX_BLOCK).min(next_event - pos);
        engine.process(n);
        left.extend_from_slice(&engine.out_left[..n]);
        right.extend_from_slice(&engine.out_right[..n]);
        pos += n;
    }
    (left, right)
}

fn apply(engine: &mut Engine, e: Event) {
    match e {
        Event::Param(id, v) => engine.set_param(id, v),
        Event::NoteOn(n, v) => engine.note_on(n, v),
        Event::NoteOff(n) => engine.note_off(n),
        Event::Transport(p, bpm) => engine.set_transport(p, bpm),
        Event::Pattern { steps } => engine.sequencer.pattern_clear(steps),
        Event::PatternNote { step, note, length, velocity } => engine.sequencer.pattern_add(step, note, length, velocity),
    }
}
