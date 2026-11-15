//! OTT-style multiband compressor: three bands (Linkwitz-Riley 4th-order
//! crossovers at 88 Hz and 2.5 kHz), each with downward compression above a
//! threshold and upward compression below another. `depth` scales the applied
//! gain (in dB) from 0 to full; `time` scales attack/release (0.25x .. 4x).
//! Detection is stereo-linked per band. Upward gain is capped and faded out
//! near silence so it never pumps up the noise floor or produces NaNs.

use super::Effect;
use crate::dsp::{db_to_gain, gain_to_db, Biquad, BiquadKind, Smoother};
use crate::params::*;

const LOW_XOVER: f32 = 88.0;
const HIGH_XOVER: f32 = 2500.0;
const Q_BUTTER: f32 = core::f32::consts::FRAC_1_SQRT_2;

/// Per band: (downward threshold dB, upward threshold dB, output gain dB).
const BANDS: [(f32, f32, f32); 3] = [(-18.0, -40.0, 5.0), (-20.0, -42.0, 4.0), (-24.0, -44.0, 5.0)];
const DOWN_RATIO: f32 = 4.0;
const UP_RATIO: f32 = 3.0;
const MAX_UP_DB: f32 = 18.0;
/// Upward gain fades to zero between these levels (dB).
const GATE_LOW: f32 = -80.0;
const GATE_HIGH: f32 = -60.0;
const BASE_ATTACK: f32 = 0.004;
const BASE_RELEASE: f32 = 0.08;

/// An LR4 section is two identical Butterworth biquads.
#[derive(Clone, Copy, Default)]
struct Lr4([Biquad; 2]);

impl Lr4 {
    fn new(kind: fn() -> BiquadKind, hz: f32, sr: f32) -> Self {
        Self([Biquad::new(kind(), hz, Q_BUTTER, sr), Biquad::new(kind(), hz, Q_BUTTER, sr)])
    }
    #[inline]
    fn process(&mut self, x: f32) -> f32 {
        let y = self.0[0].process(x);
        self.0[1].process(y)
    }
    fn clear(&mut self) {
        self.0[0].clear();
        self.0[1].clear();
    }
}

#[derive(Clone, Copy, Default)]
struct Split {
    lp1: Lr4,
    hp1: Lr4,
    lp2: Lr4,
    hp2: Lr4,
    /// Allpass at the high crossover keeps the low band phase-aligned with mid+high.
    ap: Biquad,
}

impl Split {
    fn new(sr: f32) -> Self {
        Self {
            lp1: Lr4::new(|| BiquadKind::Lowpass, LOW_XOVER, sr),
            hp1: Lr4::new(|| BiquadKind::Highpass, LOW_XOVER, sr),
            lp2: Lr4::new(|| BiquadKind::Lowpass, HIGH_XOVER, sr),
            hp2: Lr4::new(|| BiquadKind::Highpass, HIGH_XOVER, sr),
            ap: Biquad::new(BiquadKind::Allpass, HIGH_XOVER, Q_BUTTER, sr),
        }
    }
    #[inline]
    fn process(&mut self, x: f32) -> [f32; 3] {
        let low = self.ap.process(self.lp1.process(x));
        let rest = self.hp1.process(x);
        [low, self.lp2.process(rest), self.hp2.process(rest)]
    }
    fn clear(&mut self) {
        self.lp1.clear();
        self.hp1.clear();
        self.lp2.clear();
        self.hp2.clear();
        self.ap.clear();
    }
}

pub struct Ott {
    sample_rate: f32,
    depth: Smoother,
    time: Smoother,
    split: [Split; 2],
    env: [f32; 3],
    attack: f32,
    release: f32,
}

impl Ott {
    pub fn new(sample_rate: f32) -> Self {
        let mut o = Self {
            sample_rate,
            depth: Smoother::with_time(0.5, 0.02, sample_rate),
            time: Smoother::with_time(0.5, 0.05, sample_rate),
            split: [Split::new(sample_rate); 2],
            env: [0.0; 3],
            attack: 0.0,
            release: 0.0,
        };
        o.update_times();
        o
    }

    fn update_times(&mut self) {
        let scale = 0.25 * 16.0f32.powf(self.time.value);
        let coef = |t: f32| (-1.0 / (t * scale * self.sample_rate)).exp();
        self.attack = coef(BASE_ATTACK);
        self.release = coef(BASE_RELEASE);
    }

    /// Static gain curve for one band, in dB, at full depth.
    #[inline]
    fn gain_db(band: usize, level_db: f32) -> f32 {
        let (down, up, makeup) = BANDS[band];
        let mut g = makeup;
        if level_db > down {
            g -= (level_db - down) * (1.0 - 1.0 / DOWN_RATIO);
        } else if level_db < up {
            let boost = ((up - level_db) * (1.0 - 1.0 / UP_RATIO)).min(MAX_UP_DB);
            let gate = ((level_db - GATE_LOW) / (GATE_HIGH - GATE_LOW)).clamp(0.0, 1.0);
            g += boost * gate;
        }
        g
    }
}

impl Effect for Ott {
    fn set_param(&mut self, id: u32, value: f32) {
        match id {
            FX_OTT_DEPTH => self.depth.target = value.clamp(0.0, 1.0),
            FX_OTT_TIME => self.time.target = value.clamp(0.0, 1.0),
            _ => {}
        }
    }

    fn process(&mut self, left: &mut [f32], right: &mut [f32]) {
        if self.time.moving() {
            for _ in 0..left.len() {
                self.time.next();
            }
            self.update_times();
        }
        for i in 0..left.len() {
            let depth = self.depth.next();
            let bl = self.split[0].process(left[i]);
            let br = self.split[1].process(right[i]);
            let (mut ol, mut or) = (0.0, 0.0);
            for b in 0..3 {
                let peak = bl[b].abs().max(br[b].abs());
                let coef = if peak > self.env[b] { self.attack } else { self.release };
                self.env[b] = peak + (self.env[b] - peak) * coef;
                let g = db_to_gain(Self::gain_db(b, gain_to_db(self.env[b])) * depth);
                ol += bl[b] * g;
                or += br[b] * g;
            }
            left[i] = ol;
            right[i] = or;
        }
    }

    fn reset(&mut self) {
        self.split[0].clear();
        self.split[1].clear();
        self.env = [0.0; 3];
        self.depth.snap();
        self.time.snap();
        self.update_times();
    }
}
