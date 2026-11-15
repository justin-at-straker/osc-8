//! Master-bus FX chain: distortion -> chorus -> delay -> reverb -> ott -> eq.
//!
//! Every effect implements [`Effect`] and sits in a [`Slot`] that handles the
//! enabled flag: a fully bypassed effect is skipped (no CPU, output untouched),
//! and switching on/off crossfades over a few ms so there are no clicks.
//! All buffers are allocated in `FxChain::new`; nothing allocates in `process`.

pub mod chorus;
pub mod delay;
pub mod distortion;
pub mod eq;
pub mod ott;
pub mod reverb;

use crate::params::*;

pub use chorus::Chorus;
pub use delay::Delay;
pub use distortion::Distortion;
pub use eq::Eq;
pub use ott::Ott;
pub use reverb::Reverb;

/// Largest block an effect is asked to process.
pub const FX_BLOCK: usize = 128;
const BYPASS_FADE_SECONDS: f32 = 0.01;

pub trait Effect {
    /// Set a parameter by its global ID (see `params.rs`). Unknown IDs are ignored.
    fn set_param(&mut self, id: u32, value: f32);
    /// Process in place (`left.len() == right.len() <= FX_BLOCK`), including the effect's own dry/wet mix.
    fn process(&mut self, left: &mut [f32], right: &mut [f32]);
    /// Clear all internal state (delay buffers, filters, envelopes) and snap smoothers
    /// to their targets. Called when the effect is switched on from fully bypassed.
    fn reset(&mut self);
}

/// Wraps an effect with an enabled flag and a click-free bypass crossfade.
pub struct Slot<E: Effect> {
    pub fx: E,
    enabled: bool,
    /// 0 = fully bypassed, 1 = fully on.
    amount: f32,
    /// Switched on from fully bypassed: reset state at the next `process`, after
    /// the rest of this batch of parameter changes has landed (the patch sync
    /// sends `enabled` before the effect's other params).
    pending_reset: bool,
    step: f32,
    dry_l: [f32; FX_BLOCK],
    dry_r: [f32; FX_BLOCK],
}

impl<E: Effect> Slot<E> {
    pub fn new(fx: E, sample_rate: f32) -> Self {
        Self {
            fx,
            enabled: false,
            amount: 0.0,
            pending_reset: false,
            step: 1.0 / (BYPASS_FADE_SECONDS * sample_rate),
            dry_l: [0.0; FX_BLOCK],
            dry_r: [0.0; FX_BLOCK],
        }
    }

    pub fn enabled(&self) -> bool {
        self.enabled
    }

    /// True when the effect is completely out of the signal path.
    pub fn idle(&self) -> bool {
        !self.enabled && self.amount == 0.0
    }

    pub fn set_enabled(&mut self, on: bool) {
        if on && self.idle() {
            self.pending_reset = true;
        }
        self.enabled = on;
    }

    pub fn process(&mut self, left: &mut [f32], right: &mut [f32]) {
        if self.idle() {
            return;
        }
        if self.pending_reset {
            self.pending_reset = false;
            self.fx.reset();
        }
        if self.enabled && self.amount >= 1.0 {
            self.fx.process(left, right);
            return;
        }
        let n = left.len();
        self.dry_l[..n].copy_from_slice(left);
        self.dry_r[..n].copy_from_slice(right);
        self.fx.process(left, right);
        let target = if self.enabled { 1.0 } else { 0.0 };
        for i in 0..n {
            self.amount = if target > self.amount {
                (self.amount + self.step).min(1.0)
            } else {
                (self.amount - self.step).max(0.0)
            };
            let g = self.amount;
            left[i] = self.dry_l[i] + (left[i] - self.dry_l[i]) * g;
            right[i] = self.dry_r[i] + (right[i] - self.dry_r[i]) * g;
        }
    }
}

pub struct FxChain {
    pub distortion: Slot<Distortion>,
    pub chorus: Slot<Chorus>,
    pub delay: Slot<Delay>,
    pub reverb: Slot<Reverb>,
    pub ott: Slot<Ott>,
    pub eq: Slot<Eq>,
}

impl FxChain {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            distortion: Slot::new(Distortion::new(sample_rate), sample_rate),
            chorus: Slot::new(Chorus::new(sample_rate), sample_rate),
            delay: Slot::new(Delay::new(sample_rate), sample_rate),
            reverb: Slot::new(Reverb::new(sample_rate), sample_rate),
            ott: Slot::new(Ott::new(sample_rate), sample_rate),
            eq: Slot::new(Eq::new(sample_rate), sample_rate),
        }
    }

    /// Route an FX parameter. Returns false if `id` is not an FX parameter.
    pub fn set_param(&mut self, id: u32, value: f32) -> bool {
        if !value.is_finite() {
            return (FX_FIRST..PARAM_COUNT).contains(&id);
        }
        let on = value >= 0.5;
        match id {
            FX_DIST_ENABLED => self.distortion.set_enabled(on),
            FX_DIST_TYPE..=FX_DIST_MIX => self.distortion.fx.set_param(id, value),
            FX_CHORUS_ENABLED => self.chorus.set_enabled(on),
            FX_CHORUS_RATE..=FX_CHORUS_MIX => self.chorus.fx.set_param(id, value),
            FX_DELAY_ENABLED => self.delay.set_enabled(on),
            FX_DELAY_TIME..=FX_DELAY_PING_PONG => self.delay.fx.set_param(id, value),
            FX_REVERB_ENABLED => self.reverb.set_enabled(on),
            FX_REVERB_SIZE..=FX_REVERB_MIX => self.reverb.fx.set_param(id, value),
            FX_OTT_ENABLED => self.ott.set_enabled(on),
            FX_OTT_DEPTH..=FX_OTT_TIME => self.ott.fx.set_param(id, value),
            FX_EQ_ENABLED => self.eq.set_enabled(on),
            FX_EQ_LOW..=FX_EQ_HIGH => self.eq.fx.set_param(id, value),
            _ => return false,
        }
        true
    }

    /// Tempo for synced effects (the delay).
    pub fn set_bpm(&mut self, bpm: f32) {
        self.delay.fx.set_bpm(bpm);
    }

    /// Process a block (<= FX_BLOCK frames) in place.
    pub fn process(&mut self, left: &mut [f32], right: &mut [f32]) {
        let n = left.len().min(right.len()).min(FX_BLOCK);
        let (l, r) = (&mut left[..n], &mut right[..n]);
        self.distortion.process(l, r);
        self.chorus.process(l, r);
        self.delay.process(l, r);
        self.reverb.process(l, r);
        self.ott.process(l, r);
        self.eq.process(l, r);
    }
}
