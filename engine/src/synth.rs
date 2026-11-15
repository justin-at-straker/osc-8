//! `WavetableSynth`: 8-voice polyphonic wavetable synth with per-voice modulation.
//!
//! Signal path per voice: wavetable osc -> 24 dB ZDF state-variable lowpass
//! (two cascaded Simper SVFs, crossfaded with dry for bypass) -> ADSR amp.
//!
//! Control rate: every `CONTROL` samples the knob smoothers advance, each
//! voice's modulation sources (LFOs retriggered per note, env2/env3, note
//! sources) are evaluated through the mod matrix, and the voice's control
//! values (position, gain, filter g/k, pitch increment) are computed. Those
//! values are ramped linearly per sample until the next tick, so fast LFOs on
//! cutoff/position stay smooth while transcendental math stays at control rate.
//!
//! A "shadow" voice mirrors the most recently triggered note and runs even when
//! no voice sounds; its modulation drives global targets (master, FX) and the
//! UI's modulated-value readback (`Instrument::global_mod`).
//!
//! Master volume is not applied here: the engine applies it after the FX chain.

use crate::dsp::Smoother;
use crate::envelope::{Adsr, Envelope};
use crate::instrument::Instrument;
use crate::modulation::{apply, GlobalMod, ModMatrix, ModVoice, TARGET_SLOTS};
use crate::params::*;
use crate::wavetable::{builtin_tables, Wavetable};

pub const MAX_VOICES: usize = 8;
/// Control-rate interval, samples.
pub const CONTROL: usize = 16;
/// Per-voice headroom so a few voices sum without hard-driving the soft clipper.
const VOICE_GAIN: f32 = 0.5;

// Ramped per-voice control values.
const C_POS: usize = 0;
const C_GAIN: usize = 1;
const C_G: usize = 2;
const C_K1: usize = 3;
const C_K2: usize = 4;
const C_INC: usize = 5;
const C_MIX: usize = 6;
const N_CTL: usize = 7;

/// Simper/Cytomic ZDF state-variable filter, lowpass output.
#[derive(Clone, Copy, Default)]
struct Svf {
    ic1: f32,
    ic2: f32,
}

impl Svf {
    #[inline]
    fn lowpass(&mut self, g: f32, k: f32, v0: f32) -> f32 {
        let a1 = 1.0 / (1.0 + g * (g + k));
        let a2 = g * a1;
        let a3 = g * a2;
        let v3 = v0 - self.ic2;
        let v1 = a1 * self.ic1 + a2 * v3;
        let v2 = self.ic2 + a2 * self.ic1 + a3 * v3;
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
    mods: ModVoice,
    ctl: [f32; N_CTL],
    dctl: [f32; N_CTL],
    mip: usize,
}

impl Voice {
    const fn idle() -> Self {
        Self {
            note: 0,
            velocity: 0.0,
            gate: false,
            phase: 0.0,
            env: Envelope::IDLE,
            f1: Svf { ic1: 0.0, ic2: 0.0 },
            f2: Svf { ic1: 0.0, ic2: 0.0 },
            age: 0,
            mods: ModVoice::IDLE,
            ctl: [0.0; N_CTL],
            dctl: [0.0; N_CTL],
            mip: 0,
        }
    }
    fn active(&self) -> bool {
        self.env.active()
    }
}

/// The knob values (after smoothing) that modulation is added to.
#[derive(Clone, Copy)]
struct Bases {
    position: f32,
    level: f32,
    cutoff: f32,
    resonance: f32,
    mix: f32,
    octave: f32,
    semi: f32,
    fine: f32,
}

/// Control values for one voice from the bases plus its modulation.
#[inline]
fn voice_targets(b: &Bases, m: &ModMatrix, v: &Voice, sample_rate: f32) -> ([f32; N_CTL], usize) {
    let mut off = [0.0f32; TARGET_SLOTS];
    if m.any_voice_target() {
        m.offsets(&v.mods.sources(m, v.env.level), &mut off);
    }
    let o = |id: u32| off[id as usize];
    let position = apply(OSC_A_POSITION, b.position, o(OSC_A_POSITION));
    let level = apply(OSC_A_LEVEL, b.level, o(OSC_A_LEVEL));
    let semi = apply(OSC_A_SEMI, b.semi, o(OSC_A_SEMI));
    let fine = apply(OSC_A_FINE, b.fine, o(OSC_A_FINE));
    let cutoff = apply(FILTER_CUTOFF, b.cutoff, o(FILTER_CUTOFF)).clamp(20.0, 0.45 * sample_rate);
    let res = apply(FILTER_RESONANCE, b.resonance, o(FILTER_RESONANCE)).clamp(0.0, 1.0);

    let semis = v.note as f32 - 69.0 + 12.0 * b.octave + semi + fine / 100.0;
    let freq = 440.0 * (semis / 12.0).exp2();
    let mut c = [0.0f32; N_CTL];
    c[C_POS] = position;
    c[C_GAIN] = level * v.velocity * VOICE_GAIN;
    c[C_G] = (core::f32::consts::PI * cutoff / sample_rate).tan();
    // 4th-order Butterworth pole pair (Q 0.54 / 1.31); resonance sharpens the second.
    c[C_K1] = 1.848 - 0.6 * res;
    c[C_K2] = 0.765 * (1.0 - res) + 0.04 * res;
    c[C_INC] = (freq / sample_rate).min(0.5);
    c[C_MIX] = b.mix;
    (c, Wavetable::level_for(freq, sample_rate))
}

/// Mirrors the most recently triggered note for global modulation.
#[derive(Clone, Copy)]
struct Shadow {
    note: u8,
    env1: Envelope,
    mods: ModVoice,
}

pub struct WavetableSynth {
    sample_rate: f32,
    tables: Vec<Wavetable>,
    table: usize,
    voices: [Voice; MAX_VOICES],
    age: u64,
    rng: u32,
    until_tick: usize,

    // Raw parameter values (engineering units).
    octave: f32,
    semi: f32,
    fine: f32,
    env1: Adsr,

    // Smoothed knobs (advanced at control rate).
    position: Smoother,
    level: Smoother,
    log_cutoff: Smoother,
    resonance: Smoother,
    filter_mix: Smoother,

    matrix: ModMatrix,
    shadow: Shadow,
    global: GlobalMod,

}

impl WavetableSynth {
    pub fn new(sample_rate: f32) -> Self {
        // Smoother time constants are per control tick (CONTROL samples each).
        let rate = sample_rate / CONTROL as f32;
        Self {
            sample_rate,
            tables: builtin_tables(),
            table: 0,
            voices: [Voice::idle(); MAX_VOICES],
            age: 0,
            rng: 0x9E37_79B9,
            until_tick: 0,
            octave: 0.0,
            semi: 0.0,
            fine: 0.0,
            env1: Adsr::new(0.005, 0.3, 0.7, 0.25, sample_rate),
            position: Smoother::with_time(0.0, 0.02, rate),
            level: Smoother::with_time(0.75, 0.01, rate),
            log_cutoff: Smoother::with_time(4000.0f32.ln(), 0.01, rate),
            resonance: Smoother::with_time(0.2, 0.01, rate),
            filter_mix: Smoother::with_time(1.0, 0.01, rate),
            matrix: ModMatrix::new(sample_rate),
            shadow: Shadow { note: 60, env1: Envelope::IDLE, mods: ModVoice::IDLE },
            global: GlobalMod::NONE,
        }
    }

    /// Number of voices currently sounding (for tests/metering).
    pub fn active_voices(&self) -> usize {
        self.voices.iter().filter(|v| v.active()).count()
    }

    pub fn matrix(&self) -> &ModMatrix {
        &self.matrix
    }

    /// Effective (modulated) cutoff of each sounding voice, Hz, for tests/metering.
    pub fn voice_cutoffs(&self) -> impl Iterator<Item = (u8, f32)> + '_ {
        self.voices.iter().filter(|v| v.active()).map(move |v| {
            let g = v.ctl[C_G];
            (v.note, g.atan() * self.sample_rate / core::f32::consts::PI)
        })
    }

    fn bases(&self) -> Bases {
        Bases {
            position: self.position.value,
            level: self.level.value,
            cutoff: self.log_cutoff.value.exp(),
            resonance: self.resonance.value,
            mix: self.filter_mix.value,
            octave: self.octave,
            semi: self.semi,
            fine: self.fine,
        }
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

    fn control_tick(&mut self) {
        // Knob smoothers are timed in control ticks: one step each.
        self.position.next();
        self.level.next();
        self.log_cutoff.next();
        self.resonance.next();
        self.filter_mix.next();

        let m = &self.matrix;
        let sr = self.sample_rate;
        // Shadow (global) context.
        self.shadow.env1.advance(&self.env1.params, CONTROL);
        self.shadow.mods.advance(m, CONTROL, &mut self.rng);
        self.global.active = m.active();
        self.global.offsets = [0.0; TARGET_SLOTS];
        if m.active() {
            m.offsets(&self.shadow.mods.sources(m, self.shadow.env1.level), &mut self.global.offsets);
        }

        let b = self.bases();
        let m = &self.matrix;
        for v in self.voices.iter_mut() {
            if !v.active() {
                continue;
            }
            v.mods.advance(m, CONTROL, &mut self.rng);
            let (target, mip) = voice_targets(&b, m, v, sr);
            for ((d, t), c) in v.dctl.iter_mut().zip(target).zip(v.ctl) {
                *d = (t - c) * (1.0 / CONTROL as f32);
            }
            v.mip = mip;
        }
    }

    fn render_segment(&mut self, out: &mut [f32]) {
        let table = &self.tables[self.table];
        let env = self.env1.params;
        for v in self.voices.iter_mut() {
            if !v.active() {
                continue;
            }
            let mut c = v.ctl;
            let d = v.dctl;
            for o in out.iter_mut() {
                for k in 0..N_CTL {
                    c[k] += d[k];
                }
                let osc = table.sample(v.mip, c[C_POS], v.phase);
                v.phase += c[C_INC];
                if v.phase >= 1.0 {
                    v.phase -= 1.0;
                }
                let y = v.f1.lowpass(c[C_G], c[C_K1], osc);
                let y = v.f2.lowpass(c[C_G], c[C_K2], y);
                let filtered = osc + (y - osc) * c[C_MIX];
                let amp = v.env.next(&env);
                *o += filtered * amp * c[C_GAIN];
                if !v.active() {
                    break;
                }
            }
            v.ctl = c;
            if !v.active() {
                v.f1 = Svf::default();
                v.f2 = Svf::default();
            }
        }
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
        let b = self.bases();
        let sr = self.sample_rate;
        let v = &mut self.voices[i];
        if fresh {
            *v = Voice::idle();
        }
        // Stolen/retriggered voices keep phase, filter state, env level and
        // control values so there is no discontinuity; the attack ramps from
        // the current level and the next control tick glides to the new values.
        v.note = note;
        v.velocity = velocity.clamp(0.0, 1.0);
        v.gate = true;
        v.age = self.age;
        v.env.gate_on();
        v.mods.trigger(note, v.velocity, &mut self.rng);
        if fresh {
            let (c, mip) = voice_targets(&b, &self.matrix, v, sr);
            v.ctl = c;
            v.mip = mip;
        }
        self.shadow = Shadow { note, env1: Envelope { stage: v.env.stage, level: v.env.level }, mods: v.mods };
    }

    fn note_off(&mut self, note: u8) {
        for v in self.voices.iter_mut() {
            if v.gate && v.note == note {
                v.gate = false;
                v.env.gate_off();
                v.mods.release();
            }
        }
        if self.shadow.note == note {
            self.shadow.env1.gate_off();
            self.shadow.mods.release();
        }
    }

    fn all_notes_off(&mut self) {
        for v in self.voices.iter_mut() {
            v.gate = false;
            v.env.gate_off();
            v.mods.release();
        }
        self.shadow.env1.gate_off();
        self.shadow.mods.release();
    }

    fn set_param(&mut self, id: u32, value: f32) {
        if !value.is_finite() {
            return;
        }
        if self.matrix.set_param(id, value) {
            self.global.active = self.matrix.active();
            return;
        }
        let sr = self.sample_rate;
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
            ENV1_ATTACK => self.env1.set(0, value, sr),
            ENV1_DECAY => self.env1.set(1, value, sr),
            ENV1_SUSTAIN => self.env1.set(2, value, sr),
            ENV1_RELEASE => self.env1.set(3, value, sr),
            _ => {}
        }
    }

    fn render(&mut self, left: &mut [f32], right: &mut [f32]) {
        let n = left.len().min(right.len());
        let mut pos = 0;
        while pos < n {
            if self.until_tick == 0 {
                self.control_tick();
                self.until_tick = CONTROL;
            }
            let m = (n - pos).min(self.until_tick);
            let mut out = [0.0f32; CONTROL];
            self.render_segment(&mut out[..m]);
            left[pos..pos + m].copy_from_slice(&out[..m]);
            right[pos..pos + m].copy_from_slice(&out[..m]);
            self.until_tick -= m;
            pos += m;
        }
    }

    fn set_bpm(&mut self, bpm: f32) {
        self.matrix.set_bpm(bpm);
    }

    fn set_modwheel(&mut self, value: f32) {
        if value.is_finite() {
            self.matrix.modwheel = value.clamp(0.0, 1.0);
        }
    }

    fn global_mod(&self) -> Option<&GlobalMod> {
        Some(&self.global)
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
