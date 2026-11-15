//! Sample-accurate 16th-note step sequencer. Owns musical time.
//!
//! Step `k` after transport start fires at the first sample index `>= k * samples_per_step`
//! (i.e. `ceil`). At each step boundary, notes whose length has elapsed are released first,
//! then notes starting on the step are triggered, so a note can retrigger itself.

use crate::instrument::Instrument;

pub const MAX_PATTERN_NOTES: usize = 1024;
const MAX_HELD: usize = 128;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SeqNote {
    pub step: u32,
    pub note: u8,
    pub length: u32,
    pub velocity: f32,
}

#[derive(Clone, Copy, Default)]
struct Held {
    note: u8,
    steps_left: u32,
}

pub struct Sequencer {
    sample_rate: f64,
    bpm: f64,
    playing: bool,
    steps: u32,
    notes: Vec<SeqNote>,
    current: i32,
    /// Samples (fractional) from the current render position until the next step boundary.
    next_at: f64,
    held: [Held; MAX_HELD],
    held_len: usize,
}

impl Sequencer {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            sample_rate: sample_rate as f64,
            bpm: 120.0,
            playing: false,
            steps: 16,
            notes: Vec::with_capacity(MAX_PATTERN_NOTES),
            current: -1,
            next_at: 0.0,
            held: [Held::default(); MAX_HELD],
            held_len: 0,
        }
    }

    pub fn samples_per_step(&self) -> f64 {
        self.sample_rate * 60.0 / self.bpm / 4.0
    }

    /// Current tempo (clamped to 20..400).
    pub fn bpm(&self) -> f32 {
        self.bpm as f32
    }

    pub fn playing(&self) -> bool {
        self.playing
    }

    /// The step that most recently started, or -1 when stopped.
    pub fn current_step(&self) -> i32 {
        if self.playing { self.current } else { -1 }
    }

    pub fn pattern_clear(&mut self, steps: u32) {
        self.notes.clear();
        self.steps = steps.clamp(1, 1024);
    }

    pub fn pattern_add(&mut self, step: u32, note: u32, length: u32, velocity: f32) {
        if self.notes.len() >= MAX_PATTERN_NOTES || note > 127 || !velocity.is_finite() {
            return;
        }
        self.notes.push(SeqNote {
            step,
            note: note as u8,
            length: length.max(1),
            velocity: velocity.clamp(0.0, 1.0),
        });
    }

    pub fn set_transport(&mut self, playing: bool, bpm: f32, inst: &mut dyn Instrument) {
        let bpm = if bpm.is_finite() { (bpm as f64).clamp(20.0, 400.0) } else { self.bpm };
        if self.playing && playing && bpm != self.bpm {
            // Keep our relative position inside the current step.
            self.next_at *= self.bpm / bpm;
        }
        self.bpm = bpm;
        if playing && !self.playing {
            self.playing = true;
            self.current = -1;
            self.next_at = 0.0;
        } else if !playing && self.playing {
            self.playing = false;
            self.current = -1;
            self.release_held(inst);
            inst.all_notes_off();
        }
    }

    fn release_held(&mut self, inst: &mut dyn Instrument) {
        for h in &self.held[..self.held_len] {
            inst.note_off(h.note);
        }
        self.held_len = 0;
    }

    /// How many samples can be rendered before the next sequencer event.
    /// `None` when stopped. `Some(0)` means an event is due now (call `fire`).
    pub fn samples_until_event(&self) -> Option<usize> {
        if !self.playing {
            return None;
        }
        if self.next_at <= 0.0 { Some(0) } else { Some(self.next_at.ceil() as usize) }
    }

    /// Account for `n` rendered samples.
    pub fn advance(&mut self, n: usize) {
        if self.playing {
            self.next_at -= n as f64;
        }
    }

    /// Fire every due step boundary.
    pub fn fire(&mut self, inst: &mut dyn Instrument) {
        while self.playing && self.next_at <= 0.0 {
            self.step_boundary(inst);
            self.next_at += self.samples_per_step();
        }
    }

    fn step_boundary(&mut self, inst: &mut dyn Instrument) {
        let step = if self.current < 0 { 0 } else { (self.current as u32 + 1) % self.steps };
        self.current = step as i32;

        // Note-offs first.
        let mut i = 0;
        while i < self.held_len {
            self.held[i].steps_left -= 1;
            if self.held[i].steps_left == 0 {
                inst.note_off(self.held[i].note);
                self.held_len -= 1;
                self.held[i] = self.held[self.held_len];
            } else {
                i += 1;
            }
        }

        for n in &self.notes {
            if n.step != step {
                continue;
            }
            inst.note_on(n.note, n.velocity);
            // If this pitch is already held by the sequencer, extend it instead of duplicating.
            if let Some(h) = self.held[..self.held_len].iter_mut().find(|h| h.note == n.note) {
                h.steps_left = h.steps_left.max(n.length);
            } else if self.held_len < MAX_HELD {
                self.held[self.held_len] = Held { note: n.note, steps_left: n.length };
                self.held_len += 1;
            }
        }
    }
}
