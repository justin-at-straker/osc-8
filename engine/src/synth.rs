//! `WavetableSynth`: 8-voice polyphonic wavetable synth.
//!
//! Signal path per voice: wavetable osc -> 24 dB ZDF state-variable lowpass
//! (two cascaded Simper SVFs, crossfaded with dry for bypass) -> ADSR amp.
//! Continuous parameters are smoothed per sample to avoid zipper noise.

use crate::dsp::Smoother;
use crate::instrument::Instrument;
use crate::params::*;
use crate::wavetable::{builtin_tables, Wavetable};

pub const MAX_VOICES: usize = 8;
const BLOCK: usize = 128;
/// Per-voice headroom so a few voices sum without hard-driving the soft clipper.
const VOICE_GAIN: f32 = 0.5;
const MIN_ATTACK: f32 = 0.001;
const MIN_DECAY: f32 = 0.001;
const MIN_RELEASE: f32 = 0.003;
/// Envelope "time" reaches ~1% (-40 dB) of the distance to its target.
const TIME_CONSTANTS: f32 = 4.6;
const SILENCE: f32 = 1e-4;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Stage {
    Idle,
    Attack,
    Decay,
    Sustain,
    Release,
}

#[derive(Clone, Copy)]
struct EnvParams {
    attack_inc: f32,
    decay_coef: f32,
    sustain: f32,
    release_coef: f32,
}

#[derive(Clone, Copy)]
struct Envelope {
    stage: Stage,
    level: f32,
}

impl Envelope {
    #[inline]
    fn next(&mut self, p: &EnvParams) -> f32 {
        match self.stage {
            Stage::Idle => {}
            Stage::Attack => {
                self.level += p.attack_inc;
                if self.level >= 1.0 {
                    self.level = 1.0;
                    self.stage = Stage::Decay;
                }
            }
            Stage::Decay => {
                self.level = p.sustain + (self.level - p.sustain) * p.decay_coef;
                if (self.level - p.sustain).abs() < 1e-4 {
                    self.stage = Stage::Sustain;
                }
            }
            Stage::Sustain => {
                // Follow sustain changes smoothly.
                self.level = p.sustain + (self.level - p.sustain) * p.decay_coef;
            }
            Stage::Release => {
                self.level *= p.release_coef;
                if self.level < SILENCE {
                    self.level = 0.0;
                    self.stage = Stage::Idle;
                }
            }
        }
        self.level
    }
}

/// Simper/Cytomic ZDF state-variable filter, lowpass output.
#[derive(Clone, Copy, Default)]
struct Svf {
    ic1: f32,
    ic2: f32,
}

#[derive(Clone, Copy, Default)]
struct SvfCoefs {
    a1: f32,
    a2: f32,
    a3: f32,
}

impl SvfCoefs {
    #[inline]
    fn new(g: f32, k: f32) -> Self {
        let a1 = 1.0 / (1.0 + g * (g + k));
        let a2 = g * a1;
        Self { a1, a2, a3: g * a2 }
    }
}

impl Svf {
    #[inline]
    fn lowpass(&mut self, c: &SvfCoefs, v0: f32) -> f32 {
        let v3 = v0 - self.ic2;
        let v1 = c.a1 * self.ic1 + c.a2 * v3;
        let v2 = self.ic2 + c.a2 * self.ic1 + c.a3 * v3;
        self.ic1 = 2.0 * v1 - self.ic1;
        self.ic2 = 2.0 * v2 - self.ic2;
        v2
    }
}

#[derive(Clone, Copy)]
struct Voice {
    note: u8,
    velocity: f32,
    gate: bool,
    phase: f32,
    env: Envelope,
    f1: Svf,
    f2: Svf,
    age: u64,
}

impl Voice {
    const fn idle() -> Self {
        Self {
            note: 0,
            velocity: 0.0,
            gate: false,
            phase: 0.0,
            env: Envelope { stage: Stage::Idle, level: 0.0 },
            f1: Svf { ic1: 0.0, ic2: 0.0 },
            f2: Svf { ic1: 0.0, ic2: 0.0 },
            age: 0,
        }
    }
    fn active(&self) -> bool {
        self.env.stage != Stage::Idle
    }
}

pub struct WavetableSynth {
    sample_rate: f32,
    tables: Vec<Wavetable>,
    table: usize,
    voices: [Voice; MAX_VOICES],
    age: u64,

    // Raw parameter values (engineering units).
    octave: f32,
    semi: f32,
    fine: f32,
    attack: f32,
    decay: f32,
    sustain: f32,
    release: f32,
    env: EnvParams,

    // Smoothed parameters.
    position: Smoother,
    level: Smoother,
    log_cutoff: Smoother,
    resonance: Smoother,
    filter_mix: Smoother,
    volume: Smoother,

    // Per-sample scratch (shared by all voices), sized to one block.
    s_position: [f32; BLOCK],
    s_gain: [f32; BLOCK],
    s_mix: [f32; BLOCK],
    s_c1: [SvfCoefs; BLOCK],
    s_c2: [SvfCoefs; BLOCK],
    s_out: [f32; BLOCK],
}

impl WavetableSynth {
    pub fn new(sample_rate: f32) -> Self {
        let mut s = Self {
            sample_rate,
            tables: builtin_tables(),
            table: 0,
            voices: [Voice::idle(); MAX_VOICES],
            age: 0,
            octave: 0.0,
            semi: 0.0,
            fine: 0.0,
            attack: 0.005,
            decay: 0.3,
            sustain: 0.7,
            release: 0.25,
            env: EnvParams { attack_inc: 0.0, decay_coef: 0.0, sustain: 0.7, release_coef: 0.0 },
            position: Smoother::new(0.0),
            level: Smoother::new(0.75),
            log_cutoff: Smoother::new(4000.0f32.ln()),
            resonance: Smoother::new(0.2),
            filter_mix: Smoother::new(1.0),
            volume: Smoother::new(0.7),
            s_position: [0.0; BLOCK],
            s_gain: [0.0; BLOCK],
            s_mix: [0.0; BLOCK],
            s_c1: [SvfCoefs::default(); BLOCK],
            s_c2: [SvfCoefs::default(); BLOCK],
            s_out: [0.0; BLOCK],
        };
        s.position.set_time(0.02, sample_rate);
        s.level.set_time(0.01, sample_rate);
        s.log_cutoff.set_time(0.01, sample_rate);
        s.resonance.set_time(0.01, sample_rate);
        s.filter_mix.set_time(0.01, sample_rate);
        s.volume.set_time(0.01, sample_rate);
        s.update_env();
        s
    }

    fn update_env(&mut self) {
        let sr = self.sample_rate;
        self.env = EnvParams {
            attack_inc: 1.0 / (self.attack.max(MIN_ATTACK) * sr),
            decay_coef: (-TIME_CONSTANTS / (self.decay.max(MIN_DECAY) * sr)).exp(),
            sustain: self.sustain.clamp(0.0, 1.0),
            release_coef: (-TIME_CONSTANTS / (self.release.max(MIN_RELEASE) * sr)).exp(),
        };
    }

    /// Number of voices currently sounding (for tests/metering).
    pub fn active_voices(&self) -> usize {
        self.voices.iter().filter(|v| v.active()).count()
    }

    fn pick_voice(&self, note: u8) -> (usize, bool) {
        // Retrigger the same note if it is still sounding.
        if let Some(i) = self.voices.iter().position(|v| v.active() && v.note == note) {
            return (i, false);
        }
        if let Some(i) = self.voices.iter().position(|v| !v.active()) {
            return (i, true);
        }
        // Steal the quietest released voice, else the oldest held one.
        let released = self
            .voices
            .iter()
            .enumerate()
            .filter(|(_, v)| !v.gate)
            .min_by(|a, b| a.1.env.level.total_cmp(&b.1.env.level))
            .map(|(i, _)| i);
        if let Some(i) = released {
            return (i, false);
        }
        let oldest = self.voices.iter().enumerate().min_by_key(|(_, v)| v.age).map(|(i, _)| i).unwrap_or(0);
        (oldest, false)
    }

    fn prepare_block(&mut self, n: usize) {
        let sr = self.sample_rate;
        let max_fc = sr * 0.45;
        for i in 0..n {
            self.s_position[i] = self.position.next();
            self.s_gain[i] = self.level.next() * self.volume.next() * VOICE_GAIN;
            self.s_mix[i] = self.filter_mix.next();
            let fc = self.log_cutoff.next().exp().clamp(20.0, max_fc);
            let g = (core::f32::consts::PI * fc / sr).tan();
            let res = self.resonance.next().clamp(0.0, 1.0);
            // 4th-order Butterworth pole pair (Q 0.54 / 1.31); resonance sharpens the second.
            let k1 = 1.848 - 0.6 * res;
            let k2 = 0.765 * (1.0 - res) + 0.04 * res;
            self.s_c1[i] = SvfCoefs::new(g, k1);
            self.s_c2[i] = SvfCoefs::new(g, k2);
        }
    }

    fn render_block(&mut self, left: &mut [f32], right: &mut [f32]) {
        let n = left.len();
        self.prepare_block(n);
        self.s_out[..n].iter_mut().for_each(|v| *v = 0.0);
        let pitch_offset = 12.0 * self.octave + self.semi + self.fine / 100.0;
        let table = &self.tables[self.table];
        let env = self.env;
        for v in self.voices.iter_mut() {
            if !v.active() {
                continue;
            }
            let semis = v.note as f32 - 69.0 + pitch_offset;
            let freq = 440.0 * (semis / 12.0).exp2();
            let inc = (freq / self.sample_rate).min(0.5);
            let level = Wavetable::level_for(freq, self.sample_rate);
            for i in 0..n {
                let osc = table.sample(level, self.s_position[i], v.phase);
                v.phase += inc;
                if v.phase >= 1.0 {
                    v.phase -= 1.0;
                }
                let y = v.f1.lowpass(&self.s_c1[i], osc);
                let y = v.f2.lowpass(&self.s_c2[i], y);
                let mix = self.s_mix[i];
                let filtered = osc + (y - osc) * mix;
                let amp = v.env.next(&env);
                self.s_out[i] += filtered * amp * v.velocity * self.s_gain[i];
                if !v.active() {
                    break;
                }
            }
            if !v.active() {
                v.f1 = Svf::default();
                v.f2 = Svf::default();
            }
        }
        left.copy_from_slice(&self.s_out[..n]);
        right.copy_from_slice(&self.s_out[..n]);
    }
}

impl Instrument for WavetableSynth {
    fn note_on(&mut self, note: u8, velocity: f32) {
        if velocity <= 0.0 {
            self.note_off(note);
            return;
        }
        let (i, fresh) = self.pick_voice(note);
        self.age += 1;
        let v = &mut self.voices[i];
        if fresh {
            *v = Voice::idle();
        }
        // Stolen/retriggered voices keep phase, filter state and env level so
        // there is no discontinuity; the attack ramps from the current level.
        v.note = note;
        v.velocity = velocity.clamp(0.0, 1.0);
        v.gate = true;
        v.age = self.age;
        v.env.stage = Stage::Attack;
    }

    fn note_off(&mut self, note: u8) {
        for v in self.voices.iter_mut() {
            if v.gate && v.note == note {
                v.gate = false;
                if v.active() {
                    v.env.stage = Stage::Release;
                }
            }
        }
    }

    fn all_notes_off(&mut self) {
        for v in self.voices.iter_mut() {
            v.gate = false;
            if v.active() {
                v.env.stage = Stage::Release;
            }
        }
    }

    fn set_param(&mut self, id: u32, value: f32) {
        if !value.is_finite() {
            return;
        }
        match id {
            OSC_A_TABLE => self.table = (value.round().max(0.0) as usize).min(self.tables.len() - 1),
            OSC_A_POSITION => self.position.target = value.clamp(0.0, 1.0),
            OSC_A_LEVEL => self.level.target = value.clamp(0.0, 1.0),
            OSC_A_OCTAVE => self.octave = value.round().clamp(-4.0, 4.0),
            OSC_A_SEMI => self.semi = value.round().clamp(-12.0, 12.0),
            OSC_A_FINE => self.fine = value.clamp(-100.0, 100.0),
            FILTER_CUTOFF => self.log_cutoff.target = value.clamp(20.0, 20000.0).ln(),
            FILTER_RESONANCE => self.resonance.target = value.clamp(0.0, 1.0),
            FILTER_ENABLED => self.filter_mix.target = if value >= 0.5 { 1.0 } else { 0.0 },
            ENV1_ATTACK => {
                self.attack = value.clamp(0.0, 20.0);
                self.update_env();
            }
            ENV1_DECAY => {
                self.decay = value.clamp(0.0, 20.0);
                self.update_env();
            }
            ENV1_SUSTAIN => {
                self.sustain = value.clamp(0.0, 1.0);
                self.update_env();
            }
            ENV1_RELEASE => {
                self.release = value.clamp(0.0, 20.0);
                self.update_env();
            }
            MASTER_VOLUME => self.volume.target = value.clamp(0.0, 1.0),
            _ => {}
        }
    }

    fn render(&mut self, left: &mut [f32], right: &mut [f32]) {
        let n = left.len().min(right.len());
        let mut pos = 0;
        while pos < n {
            let m = (n - pos).min(BLOCK);
            let (l, r) = (&mut left[pos..pos + m], &mut right[pos..pos + m]);
            self.render_block(l, r);
            pos += m;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn envelope_releases_to_idle() {
        let mut s = WavetableSynth::new(48000.0);
        s.set_param(ENV1_RELEASE, 0.01);
        s.note_on(60, 1.0);
        let (mut l, mut r) = (vec![0.0; 4800], vec![0.0; 4800]);
        s.render(&mut l, &mut r);
        assert_eq!(s.active_voices(), 1);
        s.note_off(60);
        s.render(&mut l, &mut r);
        assert_eq!(s.active_voices(), 0);
    }

    #[test]
    fn voice_stealing_caps_at_max() {
        let mut s = WavetableSynth::new(48000.0);
        for n in 0..20 {
            s.note_on(40 + n, 1.0);
        }
        assert_eq!(s.active_voices(), MAX_VOICES);
        // The newest note must be sounding.
        assert!(s.voices.iter().any(|v| v.note == 59 && v.gate));
    }
}
