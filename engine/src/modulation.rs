//! Modulation: LFOs, mod envelopes, per-note sources and the 16-slot matrix.
//!
//! Sources produce values per voice ([`ModVoice`]); the [`ModMatrix`] turns a
//! voice's source values into normalized offsets per target param. An offset
//! of 1 spans the target's whole [min, max] range (log ranges in log space),
//! and [`apply`] adds it to the knob's base value and clamps. Everything runs at
//! control rate; callers ramp the results per sample.

use crate::dsp::fast_sin;
use crate::envelope::{Adsr, Envelope};
use crate::params::*;

/// Per-param arrays (offsets, readback) are indexed by param ID: 0..PARAM_COUNT.
pub const TARGET_SLOTS: usize = PARAM_COUNT as usize;

/// MOD_SOURCES indices.
pub mod src {
    pub const NONE: usize = 0;
    pub const ENV1: usize = 1;
    pub const ENV2: usize = 2;
    pub const ENV3: usize = 3;
    pub const LFO1: usize = 4;
    pub const VELOCITY: usize = 8;
    pub const MODWHEEL: usize = 9;
    pub const NOTE: usize = 10;
    pub const RANDOM: usize = 11;
    pub const COUNT: usize = 12;
}

/// A modulatable param and the range an amount of 1 spans.
#[derive(Clone, Copy, Debug)]
pub struct Target {
    pub id: u32,
    pub min: f32,
    pub max: f32,
    pub log: bool,
}

const fn t(id: u32, min: f32, max: f32) -> Target {
    Target { id, min, max, log: false }
}

/// Mirrors MOD_TARGETS in src/engine/params.ts.
pub const TARGETS: [Target; 31] = [
    t(OSC_A_POSITION, 0.0, 1.0),
    t(OSC_A_LEVEL, 0.0, 1.0),
    t(OSC_A_SEMI, -24.0, 24.0),
    t(OSC_A_FINE, -100.0, 100.0),
    t(OSC_A_PAN, -1.0, 1.0),
    t(OSC_A_DETUNE, 0.0, 1.0),
    t(OSC_A_BLEND, 0.0, 1.0),
    t(OSC_A_SPREAD, 0.0, 1.0),
    t(OSC_B_POSITION, 0.0, 1.0),
    t(OSC_B_LEVEL, 0.0, 1.0),
    t(OSC_B_PAN, -1.0, 1.0),
    t(OSC_B_SEMI, -24.0, 24.0),
    t(OSC_B_FINE, -100.0, 100.0),
    t(OSC_B_DETUNE, 0.0, 1.0),
    t(SUB_LEVEL, 0.0, 1.0),
    t(NOISE_LEVEL, 0.0, 1.0),
    t(NOISE_COLOR, 0.0, 1.0),
    Target { id: FILTER_CUTOFF, min: 20.0, max: 20000.0, log: true },
    t(FILTER_RESONANCE, 0.0, 1.0),
    t(MASTER_VOLUME, 0.0, 1.0),
    t(FX_DIST_DRIVE, 0.0, 1.0),
    t(FX_DIST_MIX, 0.0, 1.0),
    t(FX_CHORUS_MIX, 0.0, 1.0),
    t(FX_DELAY_MIX, 0.0, 1.0),
    t(FX_DELAY_FEEDBACK, 0.0, 1.0),
    t(FX_REVERB_MIX, 0.0, 1.0),
    t(FX_REVERB_SIZE, 0.0, 1.0),
    t(FX_OTT_DEPTH, 0.0, 1.0),
    t(FX_EQ_LOW, -12.0, 12.0),
    t(FX_EQ_MID, -12.0, 12.0),
    t(FX_EQ_HIGH, -12.0, 12.0),
];

/// Targets rendered per voice inside the synth; the rest are global (master/FX).
pub const VOICE_TARGETS: [u32; 19] = [
    OSC_A_POSITION, OSC_A_LEVEL, OSC_A_SEMI, OSC_A_FINE, OSC_A_PAN, OSC_A_DETUNE, OSC_A_BLEND, OSC_A_SPREAD,
    OSC_B_POSITION, OSC_B_LEVEL, OSC_B_PAN, OSC_B_SEMI, OSC_B_FINE, OSC_B_DETUNE,
    SUB_LEVEL, NOISE_LEVEL, NOISE_COLOR, FILTER_CUTOFF, FILTER_RESONANCE,
];

/// Master/FX targets, applied by the engine once per block.
#[inline]
pub fn is_global_target(id: u32) -> bool {
    id == MASTER_VOLUME || (FX_FIRST..BASE_PARAM_COUNT).contains(&id)
}

pub fn target(id: u32) -> Option<&'static Target> {
    TARGETS.iter().find(|t| t.id == id)
}

/// Effective value of `id` for a knob at `base` plus a normalized `offset`, clamped.
#[inline]
pub fn apply(id: u32, base: f32, offset: f32) -> f32 {
    let Some(t) = target(id) else { return base };
    apply_target(t, base, offset)
}

#[inline]
pub fn apply_target(t: &Target, base: f32, offset: f32) -> f32 {
    if offset == 0.0 {
        return base;
    }
    if t.log {
        let (lo, hi) = (t.min.ln(), t.max.ln());
        let v = base.clamp(t.min, t.max).ln() + offset * (hi - lo);
        if v >= hi {
            t.max
        } else if v <= lo {
            t.min
        } else {
            v.exp()
        }
    } else {
        (base + offset * (t.max - t.min)).clamp(t.min, t.max)
    }
}

/// LFO_SHAPES indices.
pub const SHAPE_SINE: usize = 0;
pub const SHAPE_TRIANGLE: usize = 1;
pub const SHAPE_SAW: usize = 2;
pub const SHAPE_SQUARE: usize = 3;
pub const SHAPE_RANDOM: usize = 4;

/// Sync divisions in beats: 1/1, 1/2, 1/4, 1/8, 1/16, 1/4t, 1/8t, 1/8d.
pub const DIVISION_BEATS: [f32; 8] = [4.0, 2.0, 1.0, 0.5, 0.25, 2.0 / 3.0, 1.0 / 3.0, 0.75];
/// Random S&H glide, seconds.
const RANDOM_GLIDE: f32 = 0.004;

#[derive(Clone, Copy, Debug)]
pub struct LfoParams {
    pub shape: usize,
    pub rate: f32,
    pub sync: bool,
    pub division: usize,
    pub one_shot: bool,
}

#[derive(Clone, Copy, Debug)]
pub struct Route {
    pub source: usize,
    pub target: i32,
    pub amount: f32,
    pub aux: usize,
}

impl Route {
    const EMPTY: Self = Self { source: src::NONE, target: -1, amount: 0.0, aux: src::NONE };
}

pub struct ModMatrix {
    sample_rate: f32,
    bpm: f32,
    pub modwheel: f32,
    pub lfos: [LfoParams; 4],
    pub env2: Adsr,
    pub env3: Adsr,
    pub routes: [Route; MOD_SLOTS as usize],
    /// Indices of routes that can affect anything (valid source, target, amount != 0).
    live: [usize; MOD_SLOTS as usize],
    live_len: usize,
    /// Per target param: does any live route hit it?
    targeted: [bool; TARGET_SLOTS],
}

impl ModMatrix {
    pub fn new(sample_rate: f32) -> Self {
        let lfo = LfoParams { shape: SHAPE_SINE, rate: 1.0, sync: true, division: 2, one_shot: false };
        Self {
            sample_rate,
            bpm: 120.0,
            modwheel: 0.0,
            lfos: [lfo; 4],
            env2: Adsr::new(0.01, 0.4, 0.0, 0.3, sample_rate),
            env3: Adsr::new(0.01, 0.4, 0.0, 0.3, sample_rate),
            routes: [Route::EMPTY; MOD_SLOTS as usize],
            live: [0; MOD_SLOTS as usize],
            live_len: 0,
            targeted: [false; TARGET_SLOTS],
        }
    }

    pub fn set_bpm(&mut self, bpm: f32) {
        if bpm.is_finite() && bpm > 0.0 {
            self.bpm = bpm.clamp(20.0, 400.0);
        }
    }

    /// Handle a modulation param (IDs LFO_BASE..MOD_END). Returns false for other IDs.
    pub fn set_param(&mut self, id: u32, value: f32) -> bool {
        if !(LFO_BASE..MOD_END).contains(&id) {
            return false;
        }
        if !value.is_finite() {
            return true;
        }
        let index = |v: f32, n: usize| (v.round().max(0.0) as usize).min(n - 1);
        if id < ENV_BASE {
            let l = &mut self.lfos[((id - LFO_BASE) / LFO_STRIDE) as usize];
            match (id - LFO_BASE) % LFO_STRIDE {
                LFO_SHAPE => l.shape = index(value, 5),
                LFO_RATE => l.rate = value.clamp(0.01, 50.0),
                LFO_SYNC => l.sync = value >= 0.5,
                LFO_DIVISION => l.division = index(value, DIVISION_BEATS.len()),
                _ => l.one_shot = value >= 0.5,
            }
        } else if id < MOD_BASE {
            let k = id - ENV_BASE;
            let env = if k < ENV_STRIDE { &mut self.env2 } else { &mut self.env3 };
            env.set((k % ENV_STRIDE) as usize, value, self.sample_rate);
        } else {
            let r = &mut self.routes[((id - MOD_BASE) / MOD_STRIDE) as usize];
            match (id - MOD_BASE) % MOD_STRIDE {
                MOD_SOURCE => r.source = index(value, src::COUNT),
                MOD_TARGET => r.target = if value >= 0.0 { value.round() as i32 } else { -1 },
                MOD_AMOUNT => r.amount = value.clamp(-1.0, 1.0),
                _ => r.aux = index(value, src::COUNT),
            }
            self.refresh_live();
        }
        true
    }

    fn refresh_live(&mut self) {
        self.live_len = 0;
        self.targeted = [false; TARGET_SLOTS];
        for (i, r) in self.routes.iter().enumerate() {
            if r.source != src::NONE && r.amount != 0.0 && r.target >= 0 && target(r.target as u32).is_some() {
                self.live[self.live_len] = i;
                self.live_len += 1;
                self.targeted[r.target as usize] = true;
            }
        }
    }

    /// Any route that can change a value?
    pub fn active(&self) -> bool {
        self.live_len > 0
    }

    pub fn is_targeted(&self, id: u32) -> bool {
        (id as usize) < TARGET_SLOTS && self.targeted[id as usize]
    }

    /// Any live route on a per-voice target?
    pub fn any_voice_target(&self) -> bool {
        VOICE_TARGETS.iter().any(|&id| self.targeted[id as usize])
    }

    /// LFO frequency in Hz (tempo-synced or free).
    pub fn lfo_hz(&self, i: usize) -> f32 {
        let l = &self.lfos[i];
        if l.sync {
            self.bpm / 60.0 / DIVISION_BEATS[l.division]
        } else {
            l.rate
        }
    }

    /// Sum every live route into normalized offsets per target param.
    /// Only entries for targeted params are written (others are left at 0).
    #[inline]
    pub fn offsets(&self, sources: &[f32; src::COUNT], out: &mut [f32; TARGET_SLOTS]) {
        for &i in &self.live[..self.live_len] {
            out[self.routes[i].target as usize] = 0.0;
        }
        for &i in &self.live[..self.live_len] {
            let r = &self.routes[i];
            let mut amount = r.amount;
            if r.aux != src::NONE {
                amount *= unipolar(r.aux, sources[r.aux]);
            }
            out[r.target as usize] += amount * sources[r.source];
        }
    }
}

/// The 0..1 view of a source (bipolar sources are mapped from -1..1).
#[inline]
fn unipolar(source: usize, v: f32) -> f32 {
    if is_bipolar(source) { 0.5 * (v + 1.0) } else { v }
}

#[inline]
pub fn is_bipolar(source: usize) -> bool {
    (src::LFO1..src::LFO1 + 4).contains(&source) || source == src::NOTE
}

/// xorshift32 -> 0..1
#[inline]
pub fn rand01(state: &mut u32) -> f32 {
    let mut x = *state;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    *state = x;
    (x >> 8) as f32 / (1u32 << 24) as f32
}

#[derive(Clone, Copy, Debug)]
pub struct LfoState {
    /// 0..1 (held at 1 when a one-shot has finished).
    pub phase: f32,
    held: f32,
    smooth: f32,
}

impl LfoState {
    const ZERO: Self = Self { phase: 0.0, held: 0.0, smooth: 0.0 };
}

#[inline]
pub fn lfo_value(shape: usize, phase: f32, random: f32) -> f32 {
    match shape {
        SHAPE_SINE => fast_sin(phase),
        SHAPE_TRIANGLE => {
            if phase < 0.25 {
                4.0 * phase
            } else if phase < 0.75 {
                2.0 - 4.0 * phase
            } else {
                4.0 * phase - 4.0
            }
        }
        SHAPE_SAW => 2.0 * phase - 1.0,
        SHAPE_SQUARE => {
            if phase < 0.5 { 1.0 } else { -1.0 }
        }
        _ => random,
    }
}

/// Per-voice modulation state: LFOs (retriggered on note-on), env2/env3 and note sources.
#[derive(Clone, Copy, Debug)]
pub struct ModVoice {
    pub lfo: [LfoState; 4],
    pub env2: Envelope,
    pub env3: Envelope,
    pub velocity: f32,
    pub note: f32,
    pub random: f32,
}

impl ModVoice {
    pub const IDLE: Self = Self {
        lfo: [LfoState::ZERO; 4],
        env2: Envelope::IDLE,
        env3: Envelope::IDLE,
        velocity: 0.0,
        note: 0.0,
        random: 0.0,
    };

    pub fn trigger(&mut self, note: u8, velocity: f32, rng: &mut u32) {
        for l in self.lfo.iter_mut() {
            l.phase = 0.0;
            l.held = rand01(rng) * 2.0 - 1.0;
            l.smooth = l.held;
        }
        self.env2.gate_on();
        self.env3.gate_on();
        self.velocity = velocity;
        self.note = ((note as f32 - 60.0) / 60.0).clamp(-1.0, 1.0);
        self.random = rand01(rng);
    }

    /// Legato: pick env2/env3 back up from a release without retriggering.
    pub fn resume(&mut self) {
        self.env2.resume();
        self.env3.resume();
    }

    pub fn release(&mut self) {
        self.env2.gate_off();
        self.env3.gate_off();
    }

    /// Advance `n` samples.
    pub fn advance(&mut self, m: &ModMatrix, n: usize, rng: &mut u32) {
        self.env2.advance(&m.env2.params, n);
        self.env3.advance(&m.env3.params, n);
        let glide = 1.0 - (-(n as f32) / (RANDOM_GLIDE * m.sample_rate)).exp();
        for (i, l) in self.lfo.iter_mut().enumerate() {
            let p = &m.lfos[i];
            l.phase += m.lfo_hz(i) * n as f32 / m.sample_rate;
            if l.phase >= 1.0 {
                if p.one_shot {
                    l.phase = 1.0;
                } else {
                    l.phase -= l.phase.floor();
                    l.held = rand01(rng) * 2.0 - 1.0;
                }
            }
            l.smooth += (l.held - l.smooth) * glide;
        }
    }

    /// Current source values, indexed by MOD_SOURCES. `env1` is the voice's amp envelope.
    #[inline]
    pub fn sources(&self, m: &ModMatrix, env1: f32) -> [f32; src::COUNT] {
        let mut s = [0.0f32; src::COUNT];
        s[src::ENV1] = env1;
        s[src::ENV2] = self.env2.level;
        s[src::ENV3] = self.env3.level;
        for i in 0..4 {
            s[src::LFO1 + i] = lfo_value(m.lfos[i].shape, self.lfo[i].phase, self.lfo[i].smooth);
        }
        s[src::VELOCITY] = self.velocity;
        s[src::MODWHEEL] = m.modwheel;
        s[src::NOTE] = self.note;
        s[src::RANDOM] = self.random;
        s
    }
}

/// Modulation evaluated from the most recently triggered note: drives global
/// targets (master volume, FX) and the UI's modulated-value readback.
#[derive(Clone, Copy, Debug)]
pub struct GlobalMod {
    /// Any live route?
    pub active: bool,
    /// Normalized offsets per target param (see [`apply`]); 0 where untargeted.
    pub offsets: [f32; TARGET_SLOTS],
}

impl GlobalMod {
    pub const NONE: Self = Self { active: false, offsets: [0.0; TARGET_SLOTS] };
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn targets_match_params_ts_order_and_ranges() {
        assert_eq!(target(FILTER_CUTOFF).unwrap().max, 20000.0);
        assert!(target(FX_DIST_TYPE).is_none());
        assert!(target(ENV1_ATTACK).is_none());
    }

    #[test]
    fn apply_is_log_symmetric_and_clamped() {
        let up = apply(FILTER_CUTOFF, 1000.0, 0.1);
        let down = apply(FILTER_CUTOFF, 1000.0, -0.1);
        assert!(((up / 1000.0).ln() + (down / 1000.0).ln()).abs() < 1e-4, "{up} {down}");
        assert_eq!(apply(FILTER_CUTOFF, 1000.0, 5.0), 20000.0);
        assert_eq!(apply(OSC_A_POSITION, 0.5, 0.25), 0.75);
        assert_eq!(apply(OSC_A_POSITION, 0.5, -2.0), 0.0);
        assert_eq!(apply(FX_DIST_TYPE, 2.0, 1.0), 2.0);
    }

    #[test]
    fn param_routing_and_aux() {
        let mut m = ModMatrix::new(48000.0);
        let slot = |s: u32, f: u32| MOD_BASE + s * MOD_STRIDE + f;
        m.set_param(slot(0, MOD_SOURCE), src::VELOCITY as f32);
        m.set_param(slot(0, MOD_TARGET), FILTER_CUTOFF as f32);
        m.set_param(slot(0, MOD_AMOUNT), 0.5);
        m.set_param(slot(1, MOD_SOURCE), src::RANDOM as f32);
        m.set_param(slot(1, MOD_TARGET), FILTER_CUTOFF as f32);
        m.set_param(slot(1, MOD_AMOUNT), 0.25);
        m.set_param(slot(1, MOD_AUX), src::VELOCITY as f32);
        assert!(m.active());
        let mut s = [0.0; src::COUNT];
        s[src::VELOCITY] = 0.5;
        s[src::RANDOM] = 1.0;
        let mut out = [0.0; TARGET_SLOTS];
        m.offsets(&s, &mut out);
        // 0.5 * 0.5 + 0.25 * 1.0 * 0.5
        assert!((out[FILTER_CUTOFF as usize] - 0.375).abs() < 1e-6);
        m.set_param(slot(0, MOD_TARGET), -1.0);
        m.set_param(slot(1, MOD_AMOUNT), 0.0);
        assert!(!m.active());
    }
}
