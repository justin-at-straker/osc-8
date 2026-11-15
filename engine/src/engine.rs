//! `Engine`: the sequencer plus one track's instrument, rendering fixed blocks
//! into output buffers the host reads from WASM memory.

use crate::instrument::Instrument;
use crate::sequencer::Sequencer;
use crate::synth::WavetableSynth;

/// Largest block `process` renders (one Web Audio render quantum).
pub const MAX_BLOCK: usize = 128;

pub struct Engine {
    pub sequencer: Sequencer,
    pub track: Box<dyn Instrument>,
    pub out_left: [f32; MAX_BLOCK],
    pub out_right: [f32; MAX_BLOCK],
}

impl Engine {
    pub fn new(sample_rate: f32) -> Self {
        Self::with_instrument(sample_rate, Box::new(WavetableSynth::new(sample_rate)))
    }

    pub fn with_instrument(sample_rate: f32, track: Box<dyn Instrument>) -> Self {
        Self {
            sequencer: Sequencer::new(sample_rate),
            track,
            out_left: [0.0; MAX_BLOCK],
            out_right: [0.0; MAX_BLOCK],
        }
    }

    pub fn set_param(&mut self, id: u32, value: f32) {
        self.track.set_param(id, value);
    }

    pub fn note_on(&mut self, note: u8, velocity: f32) {
        self.track.note_on(note, velocity);
    }

    pub fn note_off(&mut self, note: u8) {
        self.track.note_off(note);
    }

    pub fn set_transport(&mut self, playing: bool, bpm: f32) {
        self.sequencer.set_transport(playing, bpm, &mut *self.track);
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
        for s in self.out_left[..frames].iter_mut().chain(self.out_right[..frames].iter_mut()) {
            *s = soft_clip(*s);
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
