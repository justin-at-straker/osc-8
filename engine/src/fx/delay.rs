//! Tempo-synced stereo delay with optional ping-pong.
//!
//! The delay time follows the engine bpm through a smoother (a short tape-style
//! glide instead of a click). Feedback is capped below unity, passes through a
//! gentle lowpass and a soft saturator, so it can never run away. Ping-pong
//! feeds the mono input into the left line and cross-couples the two lines;
//! the routing is crossfaded when toggled.

use super::Effect;
use crate::dsp::{DelayLine, OnePole, Smoother};
use crate::params::*;

/// DELAY_TIMES in beats: 1/4, 1/8, 1/8d, 1/16, 1/4t.
pub const DIVISION_BEATS: [f32; 5] = [1.0, 0.5, 0.75, 0.25, 2.0 / 3.0];
pub const MIN_BPM: f32 = 20.0;
const MAX_FEEDBACK: f32 = 0.92;
const FEEDBACK_LOWPASS_HZ: f32 = 6000.0;

pub struct Delay {
    sample_rate: f32,
    bpm: f32,
    division: usize,
    time: Smoother, // samples
    feedback: Smoother,
    mix: Smoother,
    ping_pong: Smoother,
    lines: [DelayLine; 2],
    damp: [OnePole; 2],
}

impl Delay {
    pub fn new(sample_rate: f32) -> Self {
        let max = (DIVISION_BEATS[0] * 60.0 / MIN_BPM * sample_rate) as usize + 8;
        let mut damp = [OnePole::default(); 2];
        for d in damp.iter_mut() {
            d.set_cutoff(FEEDBACK_LOWPASS_HZ, sample_rate);
        }
        let mut d = Self {
            sample_rate,
            bpm: 120.0,
            division: 2,
            time: Smoother::with_time(0.0, 0.08, sample_rate),
            feedback: Smoother::with_time(0.35, 0.02, sample_rate),
            mix: Smoother::with_time(0.25, 0.02, sample_rate),
            ping_pong: Smoother::with_time(1.0, 0.02, sample_rate),
            lines: [DelayLine::new(max), DelayLine::new(max)],
            damp,
        };
        d.update_time();
        d.time.snap();
        d
    }

    /// Current delay time in samples (the target, before smoothing).
    pub fn time_samples(&self) -> f32 {
        self.time.target
    }

    pub fn set_bpm(&mut self, bpm: f32) {
        if bpm.is_finite() {
            self.bpm = bpm.clamp(MIN_BPM, 400.0);
            self.update_time();
        }
    }

    fn update_time(&mut self) {
        self.time.target = DIVISION_BEATS[self.division] * 60.0 / self.bpm * self.sample_rate;
    }
}

impl Effect for Delay {
    fn set_param(&mut self, id: u32, value: f32) {
        match id {
            FX_DELAY_TIME => {
                self.division = (value.round().max(0.0) as usize).min(DIVISION_BEATS.len() - 1);
                self.update_time();
            }
            FX_DELAY_FEEDBACK => self.feedback.target = value.clamp(0.0, 1.0) * MAX_FEEDBACK,
            FX_DELAY_MIX => self.mix.target = value.clamp(0.0, 1.0),
            FX_DELAY_PING_PONG => self.ping_pong.target = if value >= 0.5 { 1.0 } else { 0.0 },
            _ => {}
        }
    }

    fn process(&mut self, left: &mut [f32], right: &mut [f32]) {
        for i in 0..left.len() {
            let time = self.time.next();
            let fb = self.feedback.next();
            let mix = self.mix.next();
            let pp = self.ping_pong.next();
            let (xl, xr) = (left[i], right[i]);
            let ol = self.lines[0].read(time);
            let or = self.lines[1].read(time);
            // Feedback: lowpassed and softly saturated so it can't build up.
            let fl = self.damp[0].lowpass(ol);
            let fr = self.damp[1].lowpass(or);
            let back_l = fl + (fr - fl) * pp; // ping-pong: left is fed by right
            let back_r = fr + (fl - fr) * pp;
            let mono = 0.5 * (xl + xr);
            let in_l = xl + (mono - xl) * pp;
            let in_r = xr * (1.0 - pp);
            self.lines[0].push(in_l + (fb * back_l).tanh());
            self.lines[1].push(in_r + (fb * back_r).tanh());
            left[i] = xl + (ol - xl) * mix;
            right[i] = xr + (or - xr) * mix;
        }
    }

    fn reset(&mut self) {
        self.lines[0].clear();
        self.lines[1].clear();
        self.damp[0].z = 0.0;
        self.damp[1].z = 0.0;
        self.time.snap();
        self.feedback.snap();
        self.mix.snap();
        self.ping_pong.snap();
    }
}
