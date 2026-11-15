//! Stereo algorithmic reverb: input allpass diffusion into an 8-line feedback
//! delay network with a Hadamard mixing matrix and per-line damping.
//!
//! `size` scales the line lengths (smoothed, read with interpolation, so it
//! glides instead of clicking), `decay` sets RT60 (0.3 s .. 12 s), `damping`
//! lowers the in-loop lowpass. The matrix is orthogonal and every loop gain is
//! < 1, so the network is unconditionally stable. Buffers are sized at init
//! for the largest size.

#![allow(clippy::needless_range_loop)] // parallel arrays indexed by voice/line/tap

use super::Effect;
use crate::dsp::{DelayLine, OnePole, Smoother};
use crate::params::*;

const LINES: usize = 8;
/// Line lengths at size 1, ms (mutually prime-ish).
const LINE_MS: [f32; LINES] = [31.7, 37.1, 41.1, 43.7, 53.3, 59.9, 67.7, 73.1];
const MIN_SCALE: f32 = 0.3;
const MAX_SCALE: f32 = 1.6;
/// Input diffusers per side: (ms, gain).
const DIFFUSERS: [(f32, f32); 4] = [(4.7, 0.65), (3.6, 0.65), (12.7, 0.55), (9.3, 0.55)];
const STEREO_SPREAD_MS: f32 = 0.53;
const WET_GAIN: f32 = 0.6;

struct Allpass {
    line: DelayLine,
    len: usize,
    g: f32,
}

impl Allpass {
    fn new(len: usize, g: f32) -> Self {
        Self { line: DelayLine::new(len + 1), len: len.max(1), g }
    }
    #[inline]
    fn process(&mut self, x: f32) -> f32 {
        let d = self.line.tap(self.len);
        let v = x + self.g * d;
        self.line.push(v);
        d - self.g * v
    }
}

pub struct Reverb {
    sample_rate: f32,
    size: Smoother,
    decay: Smoother,
    damping: Smoother,
    mix: Smoother,
    lines: [DelayLine; LINES],
    damp: [OnePole; LINES],
    diff: [[Allpass; 4]; 2],
    /// Per-line loop gains, refreshed per block.
    gains: [f32; LINES],
}

impl Reverb {
    pub fn new(sample_rate: f32) -> Self {
        let ms = 0.001 * sample_rate;
        let max = (LINE_MS[LINES - 1] * MAX_SCALE * ms) as usize + 4;
        let diff = |side: usize| {
            core::array::from_fn(|k| {
                let (t, g) = DIFFUSERS[k];
                Allpass::new(((t + side as f32 * STEREO_SPREAD_MS) * ms) as usize, g)
            })
        };
        let mut r = Self {
            sample_rate,
            size: Smoother::with_time(0.6, 0.15, sample_rate),
            decay: Smoother::with_time(0.5, 0.05, sample_rate),
            damping: Smoother::with_time(0.5, 0.05, sample_rate),
            mix: Smoother::with_time(0.25, 0.02, sample_rate),
            lines: core::array::from_fn(|_| DelayLine::new(max)),
            damp: [OnePole::default(); LINES],
            diff: [diff(0), diff(1)],
            gains: [0.0; LINES],
        };
        r.update_block_params();
        r
    }

    fn scale(size: f32) -> f32 {
        MIN_SCALE + (MAX_SCALE - MIN_SCALE) * size
    }

    fn rt60(decay: f32) -> f32 {
        0.3 * 40.0f32.powf(decay)
    }

    /// Loop gains and damping filters change slowly; compute them once per block.
    fn update_block_params(&mut self) {
        let scale = Self::scale(self.size.value);
        let rt60 = Self::rt60(self.decay.value);
        let cutoff = 18000.0 * 0.06f32.powf(self.damping.value); // 18 kHz .. ~1 kHz
        for k in 0..LINES {
            let len_s = LINE_MS[k] * scale * 0.001;
            self.gains[k] = 10f32.powf(-3.0 * len_s / rt60);
            self.damp[k].set_cutoff(cutoff.min(0.45 * self.sample_rate), self.sample_rate);
        }
    }
}

#[inline]
fn hadamard8(x: &mut [f32; LINES]) {
    let mut h = 1;
    while h < LINES {
        for i in (0..LINES).step_by(h * 2) {
            for j in i..i + h {
                let (a, b) = (x[j], x[j + h]);
                x[j] = a + b;
                x[j + h] = a - b;
            }
        }
        h *= 2;
    }
    let norm = 1.0 / (LINES as f32).sqrt();
    for v in x.iter_mut() {
        *v *= norm;
    }
}

impl Effect for Reverb {
    fn set_param(&mut self, id: u32, value: f32) {
        let v = value.clamp(0.0, 1.0);
        match id {
            FX_REVERB_SIZE => self.size.target = v,
            FX_REVERB_DECAY => self.decay.target = v,
            FX_REVERB_DAMPING => self.damping.target = v,
            FX_REVERB_MIX => self.mix.target = v,
            _ => {}
        }
    }

    fn process(&mut self, left: &mut [f32], right: &mut [f32]) {
        let ms = 0.001 * self.sample_rate;
        let n = left.len();
        // Advance block-rate smoothers by the block length.
        for _ in 0..n {
            self.decay.next();
            self.damping.next();
        }
        self.update_block_params();
        for i in 0..n {
            let scale = Self::scale(self.size.next());
            let mix = self.mix.next();
            let (xl, xr) = (left[i], right[i]);
            let mut dl = xl;
            let mut dr = xr;
            for k in 0..4 {
                dl = self.diff[0][k].process(dl);
                dr = self.diff[1][k].process(dr);
            }
            let mut v = [0.0f32; LINES];
            for k in 0..LINES {
                let out = self.lines[k].read(LINE_MS[k] * scale * ms);
                v[k] = self.damp[k].lowpass(out) * self.gains[k];
            }
            let (mut wl, mut wr) = (0.0, 0.0);
            for k in 0..LINES / 2 {
                wl += v[2 * k];
                wr += v[2 * k + 1];
            }
            hadamard8(&mut v);
            for k in 0..LINES {
                // Left feeds even lines, right odd, with alternating signs.
                let input = if k % 2 == 0 { dl } else { dr };
                let sign = if (k / 2) % 2 == 0 { 0.5 } else { -0.5 };
                self.lines[k].push(v[k] + input * sign);
            }
            let wl = wl * WET_GAIN;
            let wr = wr * WET_GAIN;
            left[i] = xl + (wl - xl) * mix;
            right[i] = xr + (wr - xr) * mix;
        }
    }

    fn reset(&mut self) {
        for l in self.lines.iter_mut() {
            l.clear();
        }
        for d in self.damp.iter_mut() {
            d.z = 0.0;
        }
        for side in self.diff.iter_mut() {
            for a in side.iter_mut() {
                a.line.clear();
            }
        }
        self.size.snap();
        self.decay.snap();
        self.damping.snap();
        self.mix.snap();
        self.update_block_params();
    }
}
