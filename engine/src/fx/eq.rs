//! Three-band EQ: low shelf 200 Hz, mid peak 1.5 kHz, high shelf 6 kHz.
//! Gains (dB) are smoothed; coefficients are recomputed only while a gain is moving.

use super::Effect;
use crate::dsp::{Biquad, BiquadKind, Smoother};
use crate::params::*;

pub const LOW_HZ: f32 = 200.0;
pub const MID_HZ: f32 = 1500.0;
pub const HIGH_HZ: f32 = 6000.0;
const SHELF_Q: f32 = core::f32::consts::FRAC_1_SQRT_2;
const MID_Q: f32 = 0.9;
/// Recompute coefficients every N samples while gains glide.
const COEF_INTERVAL: usize = 8;

pub struct Eq {
    sample_rate: f32,
    gains: [Smoother; 3],
    filters: [[Biquad; 3]; 2],
}

impl Eq {
    pub fn new(sample_rate: f32) -> Self {
        let mut e = Self {
            sample_rate,
            gains: [Smoother::with_time(0.0, 0.02, sample_rate); 3],
            filters: [[Biquad::default(); 3]; 2],
        };
        e.update();
        e
    }

    fn update(&mut self) {
        let sr = self.sample_rate;
        let g = [self.gains[0].value, self.gains[1].value, self.gains[2].value];
        for ch in self.filters.iter_mut() {
            ch[0].set(BiquadKind::LowShelf(g[0]), LOW_HZ, SHELF_Q, sr);
            ch[1].set(BiquadKind::Peak(g[1]), MID_HZ, MID_Q, sr);
            ch[2].set(BiquadKind::HighShelf(g[2]), HIGH_HZ, SHELF_Q, sr);
        }
    }
}

impl Effect for Eq {
    fn set_param(&mut self, id: u32, value: f32) {
        let db = value.clamp(-12.0, 12.0);
        match id {
            FX_EQ_LOW => self.gains[0].target = db,
            FX_EQ_MID => self.gains[1].target = db,
            FX_EQ_HIGH => self.gains[2].target = db,
            _ => {}
        }
    }

    fn process(&mut self, left: &mut [f32], right: &mut [f32]) {
        for i in 0..left.len() {
            if i % COEF_INTERVAL == 0 && self.gains.iter().any(|g| g.moving()) {
                for _ in 0..COEF_INTERVAL {
                    for g in self.gains.iter_mut() {
                        g.next();
                    }
                }
                self.update();
            }
            let (mut l, mut r) = (left[i], right[i]);
            for k in 0..3 {
                l = self.filters[0][k].process(l);
                r = self.filters[1][k].process(r);
            }
            left[i] = l;
            right[i] = r;
        }
    }

    fn reset(&mut self) {
        for g in self.gains.iter_mut() {
            g.snap();
        }
        for ch in self.filters.iter_mut() {
            for f in ch.iter_mut() {
                f.clear();
            }
        }
        self.update();
    }
}
