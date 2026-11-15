//! `DrumMachine`: an 808-style synthesized kit on its own track.
//!
//! Every voice is synthesized the way the TR-808's circuits make its sound:
//! - Kick: a resonant sine (the bridged-T "ping") whose pitch drops from ~2.5x
//!   to the tuned fundamental in a few ms, long exponential decay, a short
//!   filtered-noise click (tone), gentle saturation.
//! - Snare: two tuned resonators (~180/330 Hz) + high-passed noise with its own
//!   envelope; tone balances body vs noise, snappy sets noise level and length.
//! - Clap: band-passed noise with three rapid retriggers ~10 ms apart, then a
//!   longer "reverb" tail through the same band.
//! - Rim: a short ~1.7 kHz resonance plus a lower one, a tiny noise tick, driven.
//! - Hats/cymbal: six detuned PolyBLEP squares (the 808 metal set) through
//!   high/band-pass filters; closed is short, open longer, closed chokes open;
//!   the cymbal adds a band-passed low-mid body and rings longest.
//! - Toms: sines with a small pitch drop and a little noise.
//! - Cowbell: two squares (~540/800 Hz) through a band-pass, two-stage decay.
//!
//! Parameters (IDs 1000 + voice*8 + field, bus at 1100) are read at trigger
//! time, except level/pan/mute which act immediately. Accent adds `accent` of
//! level plus a little extra punch/brightness. The bus sums voices by pan,
//! applies drive (soft saturation with auto makeup) and level. Nothing here
//! allocates after construction (the optional test log aside).

use crate::dsp::{Biquad, BiquadKind, Smoother};
use crate::instrument::Instrument;
use core::f32::consts::TAU;

pub const DRUM_VOICES: usize = 11;
pub const KICK: usize = 0;
pub const SNARE: usize = 1;
pub const CLAP: usize = 2;
pub const RIM: usize = 3;
pub const CLOSED_HAT: usize = 4;
pub const OPEN_HAT: usize = 5;
pub const LOW_TOM: usize = 6;
pub const MID_TOM: usize = 7;
pub const HIGH_TOM: usize = 8;
pub const COWBELL: usize = 9;
pub const CYMBAL: usize = 10;

/// Param IDs (drums.ts): DRUM_PARAM_BASE + voice * DRUM_VOICE_STRIDE + field.
pub const DRUM_PARAM_BASE: u32 = 1000;
pub const DRUM_VOICE_STRIDE: u32 = 8;
pub const F_LEVEL: u32 = 0;
pub const F_TUNE: u32 = 1;
pub const F_DECAY: u32 = 2;
pub const F_TONE: u32 = 3;
pub const F_SNAPPY: u32 = 4;
pub const F_PAN: u32 = 5;
pub const F_MUTE: u32 = 6;
pub const BUS_ACCENT: u32 = 1100;
pub const BUS_LEVEL: u32 = 1101;
pub const BUS_DRIVE: u32 = 1102;
pub const BUS_SWING: u32 = 1103;

pub const MAX_DRUM_HITS: usize = 1024;
/// The 808 metal oscillator set, Hz.
const METAL_HZ: [f32; 6] = [205.3, 304.4, 369.6, 522.7, 540.0, 800.0];
const BUS_GAIN: f32 = 0.6;
const SILENT: f32 = 1e-4;

#[derive(Clone, Copy, Debug)]
pub struct VoiceParams {
    pub level: f32,
    pub tune: f32,
    pub decay: f32,
    pub tone: f32,
    pub snappy: f32,
    pub pan: f32,
    pub mute: bool,
}

const fn vp(level: f32, tune: f32, decay: f32, tone: f32, snappy: f32, pan: f32) -> VoiceParams {
    VoiceParams { level, tune, decay, tone, snappy, pan, mute: false }
}

/// `defaultKit()` in drums.ts.
pub const DEFAULT_KIT: [VoiceParams; DRUM_VOICES] = [
    vp(0.9, 0.5, 0.55, 0.4, 0.5, 0.0),
    vp(0.75, 0.5, 0.5, 0.5, 0.6, 0.0),
    vp(0.7, 0.5, 0.5, 0.5, 0.5, 0.0),
    vp(0.55, 0.5, 0.5, 0.5, 0.5, 0.0),
    vp(0.55, 0.5, 0.3, 0.5, 0.5, 0.15),
    vp(0.5, 0.5, 0.5, 0.5, 0.5, 0.15),
    vp(0.65, 0.4, 0.5, 0.5, 0.5, -0.25),
    vp(0.65, 0.5, 0.5, 0.5, 0.5, 0.0),
    vp(0.65, 0.6, 0.5, 0.5, 0.5, 0.25),
    vp(0.5, 0.5, 0.5, 0.5, 0.5, -0.1),
    vp(0.45, 0.5, 0.6, 0.5, 0.5, 0.2),
];

#[derive(Clone, Copy, Debug)]
pub struct DrumHit {
    pub step: u32,
    pub voice: usize,
    pub velocity: f32,
    pub accent: bool,
}

/// Per-sample decay multiplier for an exponential that falls 60 dB in `t60` seconds.
#[inline]
fn decay_coef(t60: f32, sr: f32) -> f32 {
    (-6.9 / (t60.max(0.001) * sr)).exp()
}

/// Map 0..1 to lo..hi exponentially.
#[inline]
fn expmap(x: f32, lo: f32, hi: f32) -> f32 {
    lo * (hi / lo).powf(x.clamp(0.0, 1.0))
}

#[inline]
fn poly_blep(t: f32, dt: f32) -> f32 {
    if t < dt {
        let x = t / dt;
        x + x - x * x - 1.0
    } else if t > 1.0 - dt {
        let x = (t - 1.0) / dt;
        x * x + x + x + 1.0
    } else {
        0.0
    }
}

/// Band-limited square in -1..1.
#[inline]
fn square(phase: &mut f32, dt: f32) -> f32 {
    let t = *phase;
    let mut y = if t < 0.5 { 1.0 } else { -1.0 };
    y += poly_blep(t, dt);
    let t2 = t + 0.5;
    y -= poly_blep(t2 - t2.floor(), dt);
    *phase += dt;
    if *phase >= 1.0 {
        *phase -= 1.0;
    }
    y
}

#[inline]
fn noise(state: &mut u32) -> f32 {
    let mut x = *state;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    *state = x;
    (x >> 8) as f32 * (2.0 / (1u32 << 24) as f32) - 1.0
}

/// One sounding drum voice. Fields are shared across kinds; each kind uses a subset.
#[derive(Clone, Copy)]
struct Voice {
    active: bool,
    /// Samples since trigger.
    n: u32,
    gain: f32,
    /// Main amplitude envelope and its per-sample coefficient.
    env: f32,
    env_c: f32,
    /// Secondary envelope (noise, second resonator, click, tail...).
    env2: f32,
    env2_c: f32,
    /// Pitch envelope (kick/toms).
    pitch: f32,
    pitch_c: f32,
    /// Choke/mute fade multiplier.
    fade: f32,
    fading: bool,
    phase: [f32; 6],
    inc: [f32; 6],
    bq: [Biquad; 3],
    rng: u32,
    /// Kind-specific scalars.
    a: f32,
    b: f32,
    c: f32,
}

impl Voice {
    const IDLE: Self = Self {
        active: false,
        n: 0,
        gain: 0.0,
        env: 0.0,
        env_c: 0.0,
        env2: 0.0,
        env2_c: 0.0,
        pitch: 0.0,
        pitch_c: 0.0,
        fade: 1.0,
        fading: false,
        phase: [0.0; 6],
        inc: [0.0; 6],
        bq: [Biquad::IDENTITY; 3],
        rng: 0x1234_5678,
        a: 0.0,
        b: 0.0,
        c: 0.0,
    };
}

pub struct DrumMachine {
    sample_rate: f32,
    pub kit: [VoiceParams; DRUM_VOICES],
    accent: f32,
    drive: f32,
    pub swing: f32,
    level: Smoother,
    voices: [Voice; DRUM_VOICES],
    levels: [Smoother; DRUM_VOICES],
    steps: u32,
    hits: Vec<DrumHit>,
    seed: u32,
    /// Samples rendered so far (for the test log).
    clock: u64,
    /// When `Some`, every trigger is recorded as (sample, voice). For tests.
    pub log: Option<Vec<(u64, usize)>>,
}

impl DrumMachine {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            sample_rate,
            kit: DEFAULT_KIT,
            accent: 0.5,
            drive: 0.15,
            swing: 0.0,
            level: Smoother::with_time(0.8, 0.01, sample_rate),
            voices: [Voice::IDLE; DRUM_VOICES],
            levels: core::array::from_fn(|i| Smoother::with_time(DEFAULT_KIT[i].level, 0.005, sample_rate)),
            steps: 16,
            hits: Vec::with_capacity(MAX_DRUM_HITS),
            seed: 0x2545_F491,
            clock: 0,
            log: None,
        }
    }

    /// Handle a drum param (IDs 1000..1104). Returns false for other IDs.
    pub fn set_param(&mut self, id: u32, value: f32) -> bool {
        if !(DRUM_PARAM_BASE..=BUS_SWING).contains(&id) {
            return false;
        }
        if !value.is_finite() {
            return true;
        }
        let u = value.clamp(0.0, 1.0);
        match id {
            BUS_ACCENT => self.accent = u,
            BUS_LEVEL => {
                self.level.target = u;
                // Nothing sounding: no glide needed.
                if self.voices.iter().all(|v| !v.active) {
                    self.level.snap();
                }
            }
            BUS_DRIVE => self.drive = u,
            BUS_SWING => self.swing = u,
            _ => {
                let voice = ((id - DRUM_PARAM_BASE) / DRUM_VOICE_STRIDE) as usize;
                if voice >= DRUM_VOICES {
                    return true;
                }
                let p = &mut self.kit[voice];
                match (id - DRUM_PARAM_BASE) % DRUM_VOICE_STRIDE {
                    F_LEVEL => {
                        p.level = u;
                        self.levels[voice].target = u;
                    }
                    F_TUNE => p.tune = u,
                    F_DECAY => p.decay = u,
                    F_TONE => p.tone = u,
                    F_SNAPPY => p.snappy = u,
                    F_PAN => p.pan = value.clamp(-1.0, 1.0),
                    F_MUTE => {
                        p.mute = value >= 0.5;
                        if p.mute {
                            self.voices[voice].fading = true;
                        }
                    }
                    _ => {}
                }
            }
        }
        true
    }

    pub fn pattern_clear(&mut self, steps: u32) {
        self.hits.clear();
        self.steps = steps.clamp(1, 1024);
    }

    pub fn pattern_add(&mut self, step: u32, voice: u32, velocity: f32, accent: bool) {
        if self.hits.len() < MAX_DRUM_HITS && (voice as usize) < DRUM_VOICES && velocity.is_finite() {
            self.hits.push(DrumHit { step, voice: voice as usize, velocity: velocity.clamp(0.0, 1.0), accent });
        }
    }

    pub fn steps(&self) -> u32 {
        self.steps
    }

    /// Swing delay for an odd 16th, in samples: up to 1/3 of a step at swing 1.
    pub fn swing_delay(&self, samples_per_step: f64) -> usize {
        (self.swing as f64 * samples_per_step / 3.0).round() as usize
    }

    /// Trigger every hit on pattern step `tick % steps`.
    pub fn play_step(&mut self, tick: u64) {
        let step = (tick % self.steps as u64) as u32;
        for i in 0..self.hits.len() {
            let h = self.hits[i];
            if h.step == step {
                self.trigger(h.voice, h.velocity, h.accent);
            }
        }
    }

    /// Is `voice` currently sounding? (For tests/metering.)
    pub fn sounding(&self, voice: usize) -> bool {
        self.voices[voice].active
    }

    /// Start a voice now.
    pub fn trigger(&mut self, voice: usize, velocity: f32, accent: bool) {
        if voice >= DRUM_VOICES || velocity <= 0.0 || self.kit[voice].mute {
            return;
        }
        if let Some(log) = self.log.as_mut() {
            log.push((self.clock, voice));
        }
        let sr = self.sample_rate;
        let p = self.kit[voice];
        let punch = if accent { self.accent } else { 0.0 };
        self.seed = self.seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
        let mut v = Voice::IDLE;
        v.active = true;
        v.rng = self.seed | 1;
        v.gain = velocity * (1.0 + punch);
        let tf = |range_oct: f32| ((p.tune - 0.5) * range_oct).exp2();
        let bq = |kind: BiquadKind, hz: f32, q: f32| Biquad::new(kind, hz.min(0.45 * sr), q, sr);
        match voice {
            KICK => {
                let f0 = expmap(p.tune, 45.0, 65.0);
                v.inc[0] = f0 / sr;
                v.a = 1.6 + 0.4 * punch; // pitch sweep: starts at (1 + a) x f0
                v.pitch = 1.0;
                v.pitch_c = (-1.0 / (0.007 * sr)).exp();
                v.env = 1.0;
                v.env_c = decay_coef(expmap(p.decay, 0.2, 2.5), sr);
                v.env2 = (0.15 + 0.85 * p.tone) * (1.0 + punch); // click
                v.env2_c = (-1.0 / (0.0012 * sr)).exp();
                v.bq[0] = bq(BiquadKind::Bandpass, 3200.0, 0.8);
            }
            SNARE => {
                let t = tf(0.8);
                v.inc[0] = 180.0 * t / sr;
                v.inc[1] = 330.0 * t / sr;
                let body = 0.08 + 0.25 * p.decay;
                v.env = 1.0;
                v.env_c = decay_coef(body, sr);
                v.pitch = 1.0; // second resonator's envelope
                v.pitch_c = decay_coef(body * 0.6, sr);
                v.env2 = 1.0;
                v.env2_c = decay_coef((0.06 + 0.3 * p.snappy) * (0.6 + 0.8 * p.decay), sr);
                v.a = 1.0 - 0.6 * p.tone; // body gain
                v.b = (0.2 + 0.9 * p.snappy) * (0.5 + p.tone + 0.3 * punch); // noise gain
                v.bq[0] = bq(BiquadKind::Highpass, 1800.0, 0.7);
                v.bq[1] = bq(BiquadKind::Lowpass, 5000.0 + 7000.0 * p.tone, 0.7);
            }
            CLAP => {
                v.env = 1.0; // retrigger bursts are computed from n
                v.env_c = (-1.0 / (0.0025 * sr)).exp();
                v.env2 = 0.0; // tail
                v.env2_c = decay_coef(0.15 + 0.6 * p.decay, sr);
                v.bq[0] = bq(BiquadKind::Bandpass, 1100.0 * tf(1.0), 1.4);
                v.bq[1] = bq(BiquadKind::Highpass, 600.0, 0.7);
                v.a = 0.5 + p.tone; // brightness: blend toward the wide band
            }
            RIM => {
                let t = tf(0.6);
                v.inc[0] = 1700.0 * t / sr;
                v.inc[1] = 480.0 * t / sr;
                v.env = 1.0;
                v.env_c = decay_coef(0.03 + 0.06 * p.decay, sr);
                v.env2 = 1.0;
                v.env2_c = (-1.0 / (0.0015 * sr)).exp();
                v.bq[0] = bq(BiquadKind::Highpass, 2500.0 + 3000.0 * p.tone, 0.7);
            }
            CLOSED_HAT | OPEN_HAT | CYMBAL => {
                let t = tf(0.6);
                for (k, hz) in METAL_HZ.iter().enumerate() {
                    v.inc[k] = hz * t / sr;
                    v.phase[k] = (k as f32 * 0.37) % 1.0;
                }
                let bright = expmap((p.tone + 0.15 * punch).min(1.0), 0.6, 1.6);
                v.env = 1.0;
                let t60 = match voice {
                    CLOSED_HAT => 0.04 + 0.2 * p.decay,
                    OPEN_HAT => 0.2 + 1.0 * p.decay,
                    _ => 0.6 + 2.4 * p.decay,
                };
                v.env_c = decay_coef(t60, sr);
                v.bq[0] = bq(BiquadKind::Bandpass, 8000.0 * bright, 0.9);
                v.bq[1] = bq(BiquadKind::Highpass, 6000.0 * bright, 0.7);
                if voice == CYMBAL {
                    v.bq[2] = bq(BiquadKind::Bandpass, 3200.0 * bright, 1.1);
                    v.env2 = 1.0; // low-mid body, shorter
                    v.env2_c = decay_coef(t60 * 0.4, sr);
                }
                if voice == CLOSED_HAT {
                    // The 808 closed hat chokes the open hat.
                    self.voices[OPEN_HAT].fading = true;
                }
            }
            LOW_TOM | MID_TOM | HIGH_TOM => {
                let f0 = [80.0, 120.0, 165.0][voice - LOW_TOM] * tf(1.0);
                v.inc[0] = f0 / sr;
                v.a = 0.25 + 0.1 * punch;
                v.pitch = 1.0;
                v.pitch_c = (-1.0 / (0.04 * sr)).exp();
                v.env = 1.0;
                v.env_c = decay_coef(0.2 + 0.9 * p.decay, sr);
                v.env2 = 0.12 * (0.5 + p.tone);
                v.env2_c = (-1.0 / (0.012 * sr)).exp();
                v.bq[0] = bq(BiquadKind::Lowpass, 2500.0 + 3000.0 * p.tone, 0.7);
            }
            COWBELL => {
                let t = tf(0.5);
                v.inc[0] = 540.0 * t / sr;
                v.inc[1] = 800.0 * t / sr;
                v.env = 1.0; // fast first stage
                v.env_c = (-1.0 / (0.01 * sr)).exp();
                v.env2 = 1.0; // slower tail
                v.env2_c = decay_coef(0.15 + 0.6 * p.decay, sr);
                v.bq[0] = bq(BiquadKind::Bandpass, 2600.0 * expmap(p.tone, 0.7, 1.4) * t, 1.4);
                v.bq[1] = bq(BiquadKind::Highpass, 400.0, 0.7);
            }
            _ => return,
        }
        self.voices[voice] = v;
    }

    /// One sample of `voice` (mono, before level/pan). Advances its state.
    #[inline]
    fn tick(v: &mut Voice, voice: usize, sr: f32) -> f32 {
        let y = match voice {
            KICK => {
                let inc = v.inc[0] * (1.0 + v.a * v.pitch);
                v.pitch *= v.pitch_c;
                let s = (TAU * v.phase[0]).sin();
                v.phase[0] += inc;
                if v.phase[0] >= 1.0 {
                    v.phase[0] -= 1.0;
                }
                let click = v.bq[0].process(noise(&mut v.rng)) * v.env2 * 1.5;
                v.env2 *= v.env2_c;
                let x = s * v.env + click;
                v.env *= v.env_c;
                (1.4 * x).tanh() * (1.0 / 1.4f32.tanh())
            }
            SNARE => {
                let s1 = (TAU * v.phase[0]).sin() * v.env;
                let s2 = (TAU * v.phase[1]).sin() * v.pitch;
                for k in 0..2 {
                    v.phase[k] += v.inc[k];
                    if v.phase[k] >= 1.0 {
                        v.phase[k] -= 1.0;
                    }
                }
                v.env *= v.env_c;
                v.pitch *= v.pitch_c;
                let w = v.bq[0].process(noise(&mut v.rng));
                let n = v.bq[1].process(w) * v.env2;
                v.env2 *= v.env2_c;
                // Envelope for "active": the longer of body and noise.
                let body = (0.65 * s1 + 0.45 * s2) * v.a;
                let y = body + n * v.b * 1.6;
                v.c = v.env.max(v.env2);
                y
            }
            CLAP => {
                let t = v.n as f32 / sr;
                // Three ~10 ms retriggers, then the tail rises in.
                let burst = if t < 0.031 {
                    let since = t % 0.0105;
                    (-since / 0.0025).exp()
                } else {
                    0.0
                };
                if t >= 0.021 {
                    if v.env2 == 0.0 {
                        v.env2 = 0.65;
                    }
                    v.env2 *= v.env2_c;
                }
                let w = noise(&mut v.rng);
                let band = v.bq[0].process(w);
                let wide = v.bq[1].process(w) * 0.25;
                let x = band + (wide - band * 0.3) * (v.a - 0.5).max(0.0);
                v.env = if t < 0.031 { 1.0 } else { v.env2 };
                x * (burst + v.env2) * 1.4
            }
            RIM => {
                let s = (TAU * v.phase[0]).sin() * 0.8 + (TAU * v.phase[1]).sin() * 0.45;
                for k in 0..2 {
                    v.phase[k] += v.inc[k];
                    if v.phase[k] >= 1.0 {
                        v.phase[k] -= 1.0;
                    }
                }
                let tick = v.bq[0].process(noise(&mut v.rng)) * v.env2;
                v.env2 *= v.env2_c;
                let x = s * v.env + tick * 0.6;
                v.env *= v.env_c;
                (2.0 * x).tanh() * 0.9
            }
            CLOSED_HAT | OPEN_HAT | CYMBAL => {
                let mut m = 0.0;
                for k in 0..6 {
                    m += square(&mut v.phase[k], v.inc[k]);
                }
                m *= 1.0 / 6.0;
                let band = v.bq[0].process(m);
                let hi = v.bq[1].process(band) * 5.0;
                let mut y = hi * v.env;
                if voice == CYMBAL {
                    y += v.bq[2].process(m) * v.env2 * 1.2;
                    v.env2 *= v.env2_c;
                }
                v.env *= v.env_c;
                y
            }
            LOW_TOM | MID_TOM | HIGH_TOM => {
                let inc = v.inc[0] * (1.0 + v.a * v.pitch);
                v.pitch *= v.pitch_c;
                let s = (TAU * v.phase[0]).sin();
                v.phase[0] += inc;
                if v.phase[0] >= 1.0 {
                    v.phase[0] -= 1.0;
                }
                let n = v.bq[0].process(noise(&mut v.rng)) * v.env2;
                v.env2 *= v.env2_c;
                let x = s * v.env + n;
                v.env *= v.env_c;
                (1.2 * x).tanh() * (1.0 / 1.2f32.tanh())
            }
            COWBELL => {
                let m = 0.5 * (square(&mut v.phase[0], v.inc[0]) + square(&mut v.phase[1], v.inc[1]));
                let band = v.bq[0].process(m);
                let x = v.bq[1].process(band) * 1.8;
                let e = 0.65 * v.env + 0.35 * v.env2;
                v.env *= v.env_c;
                v.env2 *= v.env2_c;
                v.c = e;
                x * e
            }
            _ => 0.0,
        };
        v.n = v.n.saturating_add(1);
        y
    }

    /// Is this voice done? (Every kind's envelopes have decayed.)
    #[inline]
    fn finished(v: &Voice, voice: usize, sr: f32) -> bool {
        if v.fade < SILENT {
            return true;
        }
        match voice {
            SNARE | COWBELL => v.c < SILENT && v.n > 64,
            CLAP => v.n as f32 > 0.05 * sr && v.env2 < SILENT,
            CYMBAL => v.env < SILENT && v.env2 < SILENT,
            _ => v.env < SILENT && v.env2 < SILENT,
        }
    }

    /// Render the drum bus into `left`/`right` (overwrites).
    pub fn render(&mut self, left: &mut [f32], right: &mut [f32]) {
        let n = left.len().min(right.len());
        left[..n].fill(0.0);
        right[..n].fill(0.0);
        let sr = self.sample_rate;
        let fade_c = (-1.0 / (0.004 * sr)).exp();
        for (i, v) in self.voices.iter_mut().enumerate() {
            let lv = &mut self.levels[i];
            if !v.active {
                // Keep the level smoother current even while silent.
                lv.value = lv.target;
                continue;
            }
            let p = self.kit[i];
            let (gl, gr) = ((1.0 - p.pan).sqrt(), (1.0 + p.pan).sqrt());
            for k in 0..n {
                let y = Self::tick(v, i, sr) * v.gain * lv.next() * v.fade;
                if v.fading {
                    v.fade *= fade_c;
                }
                left[k] += y * gl;
                right[k] += y * gr;
                if Self::finished(v, i, sr) {
                    v.active = false;
                    break;
                }
            }
        }
        // Bus: drive (soft saturation with makeup) and level.
        let d = self.drive;
        let g = 1.0 + 6.0 * d;
        let makeup = 0.5 / (0.5 * g).tanh();
        for k in 0..n {
            let lvl = self.level.next() * BUS_GAIN;
            for s in [&mut left[k], &mut right[k]] {
                let x = *s;
                let sat = (g * x).tanh() * makeup;
                *s = (x + (sat - x) * d) * lvl;
            }
        }
        self.clock += n as u64;
    }
}

/// The drum machine as an `Instrument`: `note` is the voice index (DRUM_VOICES order).
impl Instrument for DrumMachine {
    fn note_on(&mut self, note: u8, velocity: f32) {
        self.trigger(note as usize, velocity, false);
    }
    fn note_off(&mut self, _note: u8) {}
    fn all_notes_off(&mut self) {}
    fn set_param(&mut self, id: u32, value: f32) {
        DrumMachine::set_param(self, id, value);
    }
    fn render(&mut self, left: &mut [f32], right: &mut [f32]) {
        DrumMachine::render(self, left, right);
    }
}
