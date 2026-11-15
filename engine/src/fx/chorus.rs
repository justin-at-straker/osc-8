//! Stereo chorus: three modulated delay voices per side. Left and right voices
//! run at different LFO phases (and slightly different base delays), which is
//! what spreads the image.

#![allow(clippy::needless_range_loop)] // parallel arrays indexed by voice/line/tap

use super::Effect;
use crate::dsp::{fast_sin, DelayLine, Smoother};
use crate::params::*;

const VOICES: usize = 3;
/// Base delays per voice, ms (right side is offset a little).
const BASE_MS: [f32; VOICES] = [11.0, 15.0, 19.5];
const SIDE_OFFSET_MS: f32 = 1.7;
/// Max modulation excursion at depth 1, ms.
const MOD_MS: f32 = 6.0;
const WET_GAIN: f32 = 0.45;

pub struct Chorus {
    sample_rate: f32,
    rate: Smoother,
    depth: Smoother,
    mix: Smoother,
    phase: f32,
    lines: [DelayLine; 2],
}

impl Chorus {
    pub fn new(sample_rate: f32) -> Self {
        let max = ((BASE_MS[VOICES - 1] + SIDE_OFFSET_MS + MOD_MS + 1.0) * 0.001 * sample_rate) as usize;
        Self {
            sample_rate,
            rate: Smoother::with_time(0.8, 0.05, sample_rate),
            depth: Smoother::with_time(0.4, 0.05, sample_rate),
            mix: Smoother::with_time(0.4, 0.02, sample_rate),
            phase: 0.0,
            lines: [DelayLine::new(max), DelayLine::new(max)],
        }
    }
}

impl Effect for Chorus {
    fn set_param(&mut self, id: u32, value: f32) {
        match id {
            FX_CHORUS_RATE => self.rate.target = value.clamp(0.01, 10.0),
            FX_CHORUS_DEPTH => self.depth.target = value.clamp(0.0, 1.0),
            FX_CHORUS_MIX => self.mix.target = value.clamp(0.0, 1.0),
            _ => {}
        }
    }

    fn process(&mut self, left: &mut [f32], right: &mut [f32]) {
        let ms = 0.001 * self.sample_rate;
        for i in 0..left.len() {
            let rate = self.rate.next();
            let depth = self.depth.next();
            let mix = self.mix.next();
            self.phase += rate / self.sample_rate;
            if self.phase >= 1.0 {
                self.phase -= 1.0;
            }
            let input = [left[i], right[i]];
            let mut wet = [0.0f32; 2];
            for (side, w) in wet.iter_mut().enumerate() {
                let mut acc = 0.0;
                for v in 0..VOICES {
                    let ph = self.phase + v as f32 / VOICES as f32 + side as f32 * 0.25;
                    let d = (BASE_MS[v] + side as f32 * SIDE_OFFSET_MS + depth * MOD_MS * fast_sin(ph)) * ms;
                    acc += self.lines[side].read_cubic(d);
                }
                // Between 1/N (coherent voices) and 1/sqrt(N) (fully decorrelated).
                *w = acc * WET_GAIN;
            }
            self.lines[0].push(input[0]);
            self.lines[1].push(input[1]);
            left[i] = input[0] + (wet[0] - input[0]) * mix;
            right[i] = input[1] + (wet[1] - input[1]) * mix;
        }
    }

    fn reset(&mut self) {
        self.lines[0].clear();
        self.lines[1].clear();
        self.phase = 0.0;
        self.rate.snap();
        self.depth.snap();
        self.mix.snap();
    }
}
