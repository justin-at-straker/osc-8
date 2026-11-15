//! Distortion: tube (asymmetric tanh), soft (cubic), hard clip, wavefolder,
//! bitcrush. The shaper runs at 2x through a windowed-sinc halfband
//! oversampler; the dry path is delayed to match its latency so partial mix
//! doesn't comb. Drive has automatic makeup gain referenced to a ~-10 dBFS input (a typical single-voice level).

#![allow(clippy::needless_range_loop)] // parallel arrays indexed by voice/line/tap

use super::{Effect, FX_BLOCK};
use crate::dsp::{db_to_gain, DelayLine, OnePole, Smoother};
use crate::params::*;

const TAPS: usize = 31;
const CENTER: usize = TAPS / 2; // 15
/// Latency of up + down sampling, in base-rate samples.
pub const LATENCY: usize = CENTER;
/// Makeup is computed so a sine at this peak comes out at about the same peak.
const MAKEUP_REF: f32 = 0.3;
const TUBE_BIAS: f32 = 0.3;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum DistType {
    Tube,
    Soft,
    Hard,
    Fold,
    Bitcrush,
}

impl DistType {
    fn from_index(i: f32) -> Self {
        match i.round() as i32 {
            1 => Self::Soft,
            2 => Self::Hard,
            3 => Self::Fold,
            4 => Self::Bitcrush,
            _ => Self::Tube,
        }
    }
}

/// 2x up/down sampler for one channel.
#[derive(Clone, Copy)]
struct Oversampler {
    /// Input history, newest first.
    x: [f32; CENTER + 1],
    /// 2x-rate history, newest first (one extra slot: we decimate on the even sample).
    v: [f32; TAPS + 1],
}

impl Oversampler {
    const fn new() -> Self {
        Self { x: [0.0; CENTER + 1], v: [0.0; TAPS + 1] }
    }

    /// Push one input sample, return the two 2x-rate samples (in time order).
    #[inline]
    fn up(&mut self, h: &[f32; TAPS], input: f32) -> (f32, f32) {
        self.x.copy_within(0..CENTER, 1);
        self.x[0] = input;
        // Zero-stuffed stream filtered by h with gain 2. Even 2x samples see the
        // even taps, odd ones the odd taps (only the center, for a halfband).
        let mut even = 0.0;
        for j in 0..=CENTER {
            even += h[2 * j] * self.x[j];
        }
        let mut odd = 0.0;
        for j in 0..CENTER {
            odd += h[2 * j + 1] * self.x[j];
        }
        (2.0 * even, 2.0 * odd)
    }

    /// Push two 2x-rate samples, return one decimated output.
    #[inline]
    fn down(&mut self, h: &[f32; TAPS], a: f32, b: f32) -> f32 {
        self.v.copy_within(0..TAPS - 1, 2);
        self.v[1] = a;
        self.v[0] = b;
        // Output aligned with `a` (the even sample) so latency is a whole number of input samples.
        let mut y = 0.0;
        for k in 0..TAPS {
            y += h[k] * self.v[k + 1];
        }
        y
    }
}

fn halfband() -> [f32; TAPS] {
    let mut h = [0.0f32; TAPS];
    let mut sum = 0.0;
    for (k, v) in h.iter_mut().enumerate() {
        let n = k as f64 - CENTER as f64;
        let sinc = if n == 0.0 { 1.0 } else { (core::f64::consts::PI * n / 2.0).sin() / (core::f64::consts::PI * n / 2.0) };
        let t = 2.0 * core::f64::consts::PI * k as f64 / (TAPS - 1) as f64;
        let w = 0.42 - 0.5 * t.cos() + 0.08 * (2.0 * t).cos(); // Blackman
        *v = (0.5 * sinc * w) as f32;
        sum += *v;
    }
    for v in h.iter_mut() {
        *v /= sum;
    }
    h
}

#[inline]
fn shape(kind: DistType, x: f32) -> f32 {
    match kind {
        DistType::Tube => (x + TUBE_BIAS).tanh() - TUBE_BIAS.tanh(),
        DistType::Soft => {
            let x = x.clamp(-1.5, 1.5);
            x - (4.0 / 27.0) * x * x * x
        }
        DistType::Hard => x.clamp(-1.0, 1.0),
        DistType::Fold => (x * core::f32::consts::FRAC_PI_2).sin(),
        DistType::Bitcrush => x,
    }
}

pub struct Distortion {
    kind: DistType,
    drive: Smoother,
    mix: Smoother,
    h: [f32; TAPS],
    os: [Oversampler; 2],
    dry: [DelayLine; 2],
    dc: [OnePole; 2],
    // Bitcrush sample-and-hold state (2x rate).
    hold_phase: f32,
    held: [f32; 2],
    wet_l: [f32; FX_BLOCK],
    wet_r: [f32; FX_BLOCK],
}

impl Distortion {
    pub fn new(sample_rate: f32) -> Self {
        let mut dc = [OnePole::default(); 2];
        for d in dc.iter_mut() {
            d.set_cutoff(10.0, sample_rate);
        }
        Self {
            kind: DistType::Tube,
            drive: Smoother::with_time(0.3, 0.02, sample_rate),
            mix: Smoother::with_time(1.0, 0.02, sample_rate),
            h: halfband(),
            os: [Oversampler::new(); 2],
            dry: [DelayLine::new(LATENCY + 1), DelayLine::new(LATENCY + 1)],
            dc,
            hold_phase: 1.0,
            held: [0.0; 2],
            wet_l: [0.0; FX_BLOCK],
            wet_r: [0.0; FX_BLOCK],
        }
    }

    pub fn kind(&self) -> DistType {
        self.kind
    }

    /// Pre-gain and makeup for a drive amount.
    #[inline]
    fn gains(kind: DistType, drive: f32) -> (f32, f32) {
        match kind {
            DistType::Bitcrush => (1.0, 1.0),
            DistType::Fold => {
                let g = 1.0 + drive * 7.0;
                let r = (g * MAKEUP_REF).min(1.0);
                (g, MAKEUP_REF / (r * core::f32::consts::FRAC_PI_2).sin())
            }
            _ => {
                let g = db_to_gain(drive * 36.0);
                (g, MAKEUP_REF / shape(kind, g * MAKEUP_REF).abs().max(0.05))
            }
        }
    }
}

impl Effect for Distortion {
    fn set_param(&mut self, id: u32, value: f32) {
        match id {
            FX_DIST_TYPE => self.kind = DistType::from_index(value),
            FX_DIST_DRIVE => self.drive.target = value.clamp(0.0, 1.0),
            FX_DIST_MIX => self.mix.target = value.clamp(0.0, 1.0),
            _ => {}
        }
    }

    fn process(&mut self, left: &mut [f32], right: &mut [f32]) {
        let n = left.len();
        let kind = self.kind;
        for i in 0..n {
            let drive = self.drive.next();
            let (g, makeup) = Self::gains(kind, drive);
            let (hold, levels) = if kind == DistType::Bitcrush {
                // Up to 32x sample-rate reduction and 16 -> 2 bits, both on a curve so
                // most of the knob is in the audibly crunchy range.
                let inv = 1.0 - drive;
                (2.0 * (1.0 + 31.0 * drive * drive), (2.0f32).powf(1.0 + 14.0 * inv * inv))
            } else {
                (1.0, 1.0)
            };
            let inputs = [left[i], right[i]];
            let mut outs = [0.0f32; 2];
            // Advance the shared sample-and-hold clock once per 2x sample.
            let mut fire = [false; 2];
            for f in fire.iter_mut() {
                self.hold_phase += 1.0 / hold;
                if self.hold_phase >= 1.0 {
                    self.hold_phase -= 1.0;
                    *f = true;
                }
            }
            for c in 0..2 {
                let (a, b) = self.os[c].up(&self.h, inputs[c] * g);
                let (a, b) = if kind == DistType::Bitcrush {
                    let mut s = [a, b];
                    for (k, v) in s.iter_mut().enumerate() {
                        if fire[k] {
                            self.held[c] = (*v * levels).round() / levels;
                        }
                        *v = self.held[c];
                    }
                    (s[0], s[1])
                } else {
                    (shape(kind, a), shape(kind, b))
                };
                let y = self.os[c].down(&self.h, a, b) * makeup;
                outs[c] = if kind == DistType::Tube { self.dc[c].highpass(y) } else { y };
            }
            self.wet_l[i] = outs[0];
            self.wet_r[i] = outs[1];
        }
        for i in 0..n {
            let mix = self.mix.next();
            let dl = self.dry[0].tap(LATENCY);
            let dr = self.dry[1].tap(LATENCY);
            self.dry[0].push(left[i]);
            self.dry[1].push(right[i]);
            left[i] = dl + (self.wet_l[i] - dl) * mix;
            right[i] = dr + (self.wet_r[i] - dr) * mix;
        }
    }

    fn reset(&mut self) {
        self.os = [Oversampler::new(); 2];
        self.dry[0].clear();
        self.dry[1].clear();
        self.dc = [OnePole { z: 0.0, ..self.dc[0] }; 2];
        self.hold_phase = 1.0;
        self.held = [0.0; 2];
        self.drive.snap();
        self.mix.snap();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn halfband_is_unity_and_aligned() {
        // drive 0 hard clip on a small signal is linear: wet == dry delayed by LATENCY.
        let mut d = Distortion::new(48000.0);
        d.set_param(FX_DIST_TYPE, 2.0);
        d.set_param(FX_DIST_DRIVE, 0.0);
        d.set_param(FX_DIST_MIX, 1.0);
        d.reset();
        let mut l = [0.0f32; 128];
        let mut r = [0.0f32; 128];
        l[10] = 0.1;
        r[10] = 0.1;
        d.process(&mut l, &mut r);
        let peak = l.iter().enumerate().max_by(|a, b| a.1.abs().total_cmp(&b.1.abs())).unwrap();
        assert_eq!(peak.0, 10 + LATENCY);
        let sum: f32 = l.iter().sum();
        let (_, makeup) = Distortion::gains(DistType::Hard, 0.0);
        assert!((sum - 0.1 * makeup).abs() < 1e-3, "sum {sum}");
    }
}
