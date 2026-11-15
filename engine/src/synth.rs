//! `WavetableSynth`: 8-voice polyphonic, stereo wavetable synth.
//!
//! Per voice: osc A + osc B (wavetable, up to 16 unison voices each, detuned,
//! blended and spread across the stereo field) + sub + stereo noise. Sources
//! with `toFilter` go through a stereo 24 dB ZDF lowpass (two cascaded Simper
//! SVFs per channel, crossfaded with dry for bypass); the rest go around it.
//! Everything then goes through the ADSR amp envelope.
//!
//! Control rate: every `CONTROL` samples the knob smoothers advance, each
//! voice's modulation sources are evaluated through the mod matrix, and the
//! voice's control values (frame positions, gains, filter coefficients, every
//! unison voice's pitch increment and pan gains) are recomputed. Gains and
//! positions ramp linearly per sample until the next tick; pitch increments are
//! held for the tick (phase stays continuous). No transcendental math runs per
//! sample except the filter's reciprocal.
//!
//! A "shadow" voice mirrors the most recently triggered note and runs even when
//! no voice sounds; its modulation drives global targets (master, FX) and the
//! UI's modulated-value readback (`Instrument::global_mod`).
//!
//! Master volume is not applied here: the engine applies it after the FX chain.

use crate::dsp::Smoother;
use crate::envelope::{Adsr, Envelope};
use crate::instrument::Instrument;
use crate::modulation::{apply, rand01, GlobalMod, ModMatrix, ModVoice, TARGET_SLOTS};
use crate::params::*;
use crate::wavetable::{builtin_tables, Wavetable, FRAMES};

pub const MAX_VOICES: usize = 8;
pub const MAX_UNISON: usize = 16;
/// Control-rate interval, samples.
pub const CONTROL: usize = 16;
/// Per-voice headroom so a few voices sum without hard-driving the soft clipper.
const VOICE_GAIN: f32 = 0.5;
/// Detune 1 puts the outer unison voices this many semitones from the center.
const DETUNE_SEMITONES: f32 = 1.0;
/// Noise color: the dark end is one-pole lowpassed white noise (brown-ish); the
/// bright end is differentiated white noise (+6 dB/octave, violet-ish).
const NOISE_DARK_HZ: f32 = 250.0;

// Ramped per-voice control values.
const C_G: usize = 0;
const C_K1: usize = 1;
const C_K2: usize = 2;
const C_MIX: usize = 3;
const C_POS_A: usize = 4;
const C_GAIN_A: usize = 5;
const C_TOF_A: usize = 6;
const C_POS_B: usize = 7;
const C_GAIN_B: usize = 8;
const C_TOF_B: usize = 9;
const C_GAIN_SUB: usize = 10;
const C_GAIN_N: usize = 11;
const C_COLOR: usize = 12;
const C_TOF_N: usize = 13;
const N_CTL: usize = 14;

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

/// Simper/Cytomic ZDF state-variable filter, lowpass output.
#[derive(Clone, Copy, Default)]
struct Svf {
    ic1: f32,
    ic2: f32,
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

/// Unison stack state for one oscillator of one voice.
#[derive(Clone, Copy)]
struct UniOsc {
    phase: [f32; MAX_UNISON],
    inc: [f32; MAX_UNISON],
    gl: [f32; MAX_UNISON],
    gr: [f32; MAX_UNISON],
    dgl: [f32; MAX_UNISON],
    dgr: [f32; MAX_UNISON],
    /// Voices in the stack now.
    n: usize,
    /// Voices processed this tick (n, or the old n while removed voices fade out).
    n_proc: usize,
    mip: usize,
    table: usize,
}

impl UniOsc {
    const IDLE: Self = Self {
        phase: [0.0; MAX_UNISON],
        inc: [0.0; MAX_UNISON],
        gl: [0.0; MAX_UNISON],
        gr: [0.0; MAX_UNISON],
        dgl: [0.0; MAX_UNISON],
        dgr: [0.0; MAX_UNISON],
        n: 1,
        n_proc: 1,
        mip: 0,
        table: 0,
    };

    /// Jump straight to `t` (fresh voice).
    fn set(&mut self, t: &OscTarget) {
        self.inc = t.inc;
        self.gl = t.gl;
        self.gr = t.gr;
        self.dgl = [0.0; MAX_UNISON];
        self.dgr = [0.0; MAX_UNISON];
        self.n = t.n;
        self.n_proc = t.n;
        self.mip = t.mip;
        self.table = t.table;
    }

    /// Ramp toward `t` over the next control tick.
    fn ramp(&mut self, t: &OscTarget) {
        for u in self.n_proc..t.n {
            // Voices joining the stack fade in from silence.
            self.gl[u] = 0.0;
            self.gr[u] = 0.0;
        }
        let n_proc = self.n_proc.max(t.n);
        let k = 1.0 / CONTROL as f32;
        for u in 0..n_proc {
            self.dgl[u] = (t.gl[u] - self.gl[u]) * k;
            self.dgr[u] = (t.gr[u] - self.gr[u]) * k;
        }
        self.inc = t.inc;
        // After this tick, voices beyond t.n have faded to 0 and can be dropped.
        self.n_proc = n_proc;
        self.n = t.n;
        self.mip = t.mip;
        self.table = t.table;
    }

    /// Start phases for a new note: `phase` plus up to a full random cycle.
    fn start(&mut self, phase: f32, random_phase: f32, rng: &mut u32) {
        for p in self.phase.iter_mut() {
            let x = phase + random_phase * rand01(rng);
            *p = x - x.floor();
        }
    }
}

/// Control targets for one oscillator.
#[derive(Clone, Copy)]
struct OscTarget {
    inc: [f32; MAX_UNISON],
    gl: [f32; MAX_UNISON],
    gr: [f32; MAX_UNISON],
    n: usize,
    mip: usize,
    table: usize,
    /// Center-voice phase increment (the sub follows osc A's).
    center_inc: f32,
    position: f32,
    gain: f32,
    to_filter: f32,
}

#[derive(Clone, Copy)]
struct Noise {
    rng: [u32; 2],
    dark: [f32; 2],
    /// Previous white sample (for the differentiated bright end).
    prev: [f32; 2],
}

#[derive(Clone, Copy)]
struct Voice {
    note: u8,
    /// Sounding pitch in semitones: `note`, or on its way there while gliding.
    pitch: f32,
    /// Semitones added per control tick while gliding (0 = not gliding).
    glide_step: f32,
    velocity: f32,
    gate: bool,
    env: Envelope,
    fl: [Svf; 2],
    fr: [Svf; 2],
    age: u64,
    mods: ModVoice,
    ctl: [f32; N_CTL],
    dctl: [f32; N_CTL],
    a: UniOsc,
    b: UniOsc,
    sub_phase: f32,
    sub_inc: f32,
    sub_mip: usize,
    noise: Noise,
}

impl Voice {
    const fn idle() -> Self {
        Self {
            note: 0,
            pitch: 0.0,
            glide_step: 0.0,
            velocity: 0.0,
            gate: false,
            env: Envelope::IDLE,
            fl: [Svf { ic1: 0.0, ic2: 0.0 }; 2],
            fr: [Svf { ic1: 0.0, ic2: 0.0 }; 2],
            age: 0,
            mods: ModVoice::IDLE,
            ctl: [0.0; N_CTL],
            dctl: [0.0; N_CTL],
            a: UniOsc::IDLE,
            b: UniOsc::IDLE,
            sub_phase: 0.0,
            sub_inc: 0.0,
            sub_mip: 0,
            noise: Noise { rng: [1, 2], dark: [0.0; 2], prev: [0.0; 2] },
        }
    }
    fn active(&self) -> bool {
        self.env.active()
    }
}

/// Param IDs of one oscillator's targets (u32::MAX = not a mod target).
struct OscIds {
    position: u32,
    level: u32,
    semi: u32,
    fine: u32,
    pan: u32,
    detune: u32,
    blend: u32,
    spread: u32,
}

const IDS_A: OscIds = OscIds {
    position: OSC_A_POSITION,
    level: OSC_A_LEVEL,
    semi: OSC_A_SEMI,
    fine: OSC_A_FINE,
    pan: OSC_A_PAN,
    detune: OSC_A_DETUNE,
    blend: OSC_A_BLEND,
    spread: OSC_A_SPREAD,
};
const IDS_B: OscIds = OscIds {
    position: OSC_B_POSITION,
    level: OSC_B_LEVEL,
    semi: OSC_B_SEMI,
    fine: OSC_B_FINE,
    pan: OSC_B_PAN,
    detune: OSC_B_DETUNE,
    blend: u32::MAX,
    spread: u32::MAX,
};

/// One oscillator's knobs.
struct OscKnobs {
    enabled: Smoother,
    position: Smoother,
    level: Smoother,
    pan: Smoother,
    detune: Smoother,
    blend: Smoother,
    spread: Smoother,
    to_filter: Smoother,
    table: usize,
    octave: f32,
    semi: f32,
    fine: f32,
    unison: usize,
    phase: f32,
    random_phase: f32,
}

impl OscKnobs {
    fn new(enabled: bool, rate: f32) -> Self {
        let s = |v: f32, t: f32| Smoother::with_time(v, t, rate);
        Self {
            enabled: s(if enabled { 1.0 } else { 0.0 }, 0.005),
            position: s(0.0, 0.02),
            level: s(0.75, 0.01),
            pan: s(0.0, 0.02),
            detune: s(0.25, 0.02),
            blend: s(0.75, 0.02),
            spread: s(0.5, 0.02),
            to_filter: s(1.0, 0.005),
            table: 0,
            octave: 0.0,
            semi: 0.0,
            fine: 0.0,
            unison: 1,
            phase: 0.0,
            random_phase: 1.0,
        }
    }

    fn for_each(&mut self, f: impl Fn(&mut Smoother)) {
        for s in [
            &mut self.enabled,
            &mut self.position,
            &mut self.level,
            &mut self.pan,
            &mut self.detune,
            &mut self.blend,
            &mut self.spread,
            &mut self.to_filter,
        ] {
            f(s);
        }
    }

    fn tick(&mut self) {
        self.for_each(|s| {
            s.next();
        });
    }

    /// Voice params at `VOICE_*` offsets.
    fn set_voice_param(&mut self, field: u32, value: f32) {
        match field {
            VOICE_PAN => self.pan.target = value.clamp(-1.0, 1.0),
            VOICE_UNISON => self.unison = (value.round() as i32).clamp(1, MAX_UNISON as i32) as usize,
            VOICE_DETUNE => self.detune.target = value.clamp(0.0, 1.0),
            VOICE_BLEND => self.blend.target = value.clamp(0.0, 1.0),
            VOICE_SPREAD => self.spread.target = value.clamp(0.0, 1.0),
            VOICE_PHASE => self.phase = value.clamp(0.0, 1.0),
            VOICE_RANDOM_PHASE => self.random_phase = value.clamp(0.0, 1.0),
            _ => self.to_filter.target = if value >= 0.5 { 1.0 } else { 0.0 },
        }
    }
}

/// Unison voice positions in -1..1 for each stack size, with a small irrational
/// jitter on the inner voices so the stack doesn't beat in lockstep; and which
/// voices count as "center" for blend.
struct UnisonLayout {
    x: [[f32; MAX_UNISON]; MAX_UNISON + 1],
    center: [[bool; MAX_UNISON]; MAX_UNISON + 1],
}

impl UnisonLayout {
    fn new() -> Self {
        let mut x = [[0.0; MAX_UNISON]; MAX_UNISON + 1];
        let mut center = [[false; MAX_UNISON]; MAX_UNISON + 1];
        for n in 1..=MAX_UNISON {
            for u in 0..n {
                if n == 1 {
                    center[n][u] = true;
                    continue;
                }
                let lin = -1.0 + 2.0 * u as f32 / (n - 1) as f32;
                // Golden-angle jitter, zero at the center and the outer voices.
                let jitter = 0.35 * (u as f32 * 2.399_963 + 1.3).sin() * lin.abs() * (1.0 - lin.abs()) / (n as f32).sqrt();
                x[n][u] = (lin + jitter).clamp(-1.0, 1.0);
                center[n][u] = if n % 2 == 1 { u == n / 2 } else { u == n / 2 || u + 1 == n / 2 };
            }
        }
        Self { x, center }
    }
}

/// 2^(s/12) for |s| <= 1 (the detune range) without a transcendental call (cubic Taylor of e^x).
#[inline]
fn semitone_ratio(s: f32) -> f32 {
    let x = s * (core::f32::consts::LN_2 / 12.0);
    1.0 + x * (1.0 + x * (0.5 + x * (1.0 / 6.0)))
}

#[inline]
fn osc_targets(
    k: &OscKnobs,
    ids: &OscIds,
    off: &[f32; TARGET_SLOTS],
    pitch: f32,
    velocity: f32,
    layout: &UnisonLayout,
    sample_rate: f32,
) -> OscTarget {
    let o = |id: u32| if (id as usize) < TARGET_SLOTS { off[id as usize] } else { 0.0 };
    let semi = apply(ids.semi, k.semi, o(ids.semi));
    let fine = apply(ids.fine, k.fine, o(ids.fine));
    let semis = pitch - 69.0 + 12.0 * k.octave + semi + fine / 100.0;
    let center_inc = 440.0 * (semis / 12.0).exp2() / sample_rate;
    let detune = apply(ids.detune, k.detune.value, o(ids.detune)) * DETUNE_SEMITONES;
    let pan = apply(ids.pan, k.pan.value, o(ids.pan));
    let blend = apply(ids.blend, k.blend.value, o(ids.blend)).clamp(0.0, 1.0);
    let spread = apply(ids.spread, k.spread.value, o(ids.spread)).clamp(0.0, 1.0);
    let n = k.unison;
    let mut t = OscTarget {
        inc: [0.0; MAX_UNISON],
        gl: [0.0; MAX_UNISON],
        gr: [0.0; MAX_UNISON],
        n,
        mip: 0,
        table: k.table,
        center_inc,
        position: apply(ids.position, k.position.value, o(ids.position)),
        gain: apply(ids.level, k.level.value, o(ids.level)) * k.enabled.value * velocity * VOICE_GAIN,
        to_filter: k.to_filter.value,
    };
    let mut power = 0.0;
    let mut max_inc = 0.0f32;
    for u in 0..n {
        let x = layout.x[n][u];
        let inc = (center_inc * semitone_ratio(x * detune)).min(0.5);
        t.inc[u] = inc;
        max_inc = max_inc.max(inc);
        let w = if layout.center[n][u] { 1.0 } else { blend };
        power += w * w;
        // Stereo position: inner voices are pushed outward (|x|^0.25) so a full
        // spread is genuinely wide, not mostly-center. Constant-power pan,
        // compensated so a centered voice is 1.0 per side.
        let p = (pan + x.signum() * x.abs().sqrt().sqrt() * spread).clamp(-1.0, 1.0);
        t.gl[u] = w * (1.0 - p).sqrt();
        t.gr[u] = w * (1.0 + p).sqrt();
    }
    // Uncorrelated (detuned / random-phase) voices add in power: normalize by it.
    let norm = 1.0 / power.max(1.0).sqrt();
    for u in 0..n {
        t.gl[u] *= norm;
        t.gr[u] *= norm;
    }
    t.mip = Wavetable::level_for(max_inc * sample_rate, sample_rate);
    t
}

/// Sub/noise knobs.
struct ExtraKnobs {
    sub_enabled: Smoother,
    sub_level: Smoother,
    sub_octave: f32,
    sub_shape: usize,
    noise_enabled: Smoother,
    noise_level: Smoother,
    noise_color: Smoother,
    noise_to_filter: Smoother,
}

/// Everything the control tick needs that isn't per voice.
struct Knobs {
    a: OscKnobs,
    b: OscKnobs,
    x: ExtraKnobs,
    log_cutoff: Smoother,
    resonance: Smoother,
    filter_mix: Smoother,
}

impl Knobs {
    fn snap(&mut self) {
        self.a.for_each(Smoother::snap);
        self.b.for_each(Smoother::snap);
        for s in self.extras() {
            s.snap();
        }
    }

    fn extras(&mut self) -> [&mut Smoother; 9] {
        [
            &mut self.x.sub_enabled,
            &mut self.x.sub_level,
            &mut self.x.noise_enabled,
            &mut self.x.noise_level,
            &mut self.x.noise_color,
            &mut self.x.noise_to_filter,
            &mut self.log_cutoff,
            &mut self.resonance,
            &mut self.filter_mix,
        ]
    }

    fn tick(&mut self) {
        self.a.tick();
        self.b.tick();
        for s in self.extras() {
            s.next();
        }
    }

}

struct VoiceTargets {
    ctl: [f32; N_CTL],
    a: OscTarget,
    b: OscTarget,
    sub_inc: f32,
    sub_mip: usize,
}

/// Control targets for one voice from the knobs plus its modulation.
fn voice_targets(k: &Knobs, m: &ModMatrix, v: &Voice, layout: &UnisonLayout, sample_rate: f32) -> VoiceTargets {
    let mut off = [0.0f32; TARGET_SLOTS];
    if m.any_voice_target() {
        m.offsets(&v.mods.sources(m, v.env.level), &mut off);
    }
    let o = |id: u32| off[id as usize];
    let a = osc_targets(&k.a, &IDS_A, &off, v.pitch, v.velocity, layout, sample_rate);
    let b = osc_targets(&k.b, &IDS_B, &off, v.pitch, v.velocity, layout, sample_rate);
    let cutoff = apply(FILTER_CUTOFF, k.log_cutoff.value.exp(), o(FILTER_CUTOFF)).clamp(20.0, 0.45 * sample_rate);
    let res = apply(FILTER_RESONANCE, k.resonance.value, o(FILTER_RESONANCE)).clamp(0.0, 1.0);
    let x = &k.x;

    let mut c = [0.0f32; N_CTL];
    c[C_G] = (core::f32::consts::PI * cutoff / sample_rate).tan();
    // 4th-order Butterworth pole pair (Q 0.54 / 1.31); resonance sharpens the second.
    c[C_K1] = 1.848 - 0.6 * res;
    c[C_K2] = 0.765 * (1.0 - res) + 0.04 * res;
    c[C_MIX] = k.filter_mix.value;
    c[C_POS_A] = a.position;
    c[C_GAIN_A] = a.gain;
    c[C_TOF_A] = a.to_filter;
    c[C_POS_B] = b.position;
    c[C_GAIN_B] = b.gain;
    c[C_TOF_B] = b.to_filter;
    let vel = v.velocity * VOICE_GAIN;
    c[C_GAIN_SUB] = apply(SUB_LEVEL, x.sub_level.value, o(SUB_LEVEL)) * x.sub_enabled.value * vel;
    c[C_GAIN_N] = apply(NOISE_LEVEL, x.noise_level.value, o(NOISE_LEVEL)) * x.noise_enabled.value * vel;
    c[C_COLOR] = apply(NOISE_COLOR, x.noise_color.value, o(NOISE_COLOR));
    c[C_TOF_N] = x.noise_to_filter.value;

    let sub_inc = (a.center_inc * x.sub_octave.exp2()).min(0.5);
    VoiceTargets { ctl: c, a, b, sub_inc, sub_mip: Wavetable::level_for(sub_inc * sample_rate, sample_rate) }
}

/// Mirrors the most recently triggered note for global modulation.
#[derive(Clone, Copy)]
struct Shadow {
    note: u8,
    env1: Envelope,
    mods: ModVoice,
}

/// Precomputed noise color filter constants.
struct NoiseFilter {
    a_dark: f32,
    /// Gains that bring the dark (lowpassed) and bright (differentiated) noise back to white's level.
    k_dark: f32,
    k_bright: f32,
}

impl NoiseFilter {
    fn new(sample_rate: f32) -> Self {
        let ad = 1.0 - (-2.0 * core::f32::consts::PI * NOISE_DARK_HZ / sample_rate).exp();
        // One-pole y += a(x - y) on white noise: var(y) = a/(2-a). var(x[n] - x[n-1]) = 2.
        Self { a_dark: ad, k_dark: ((2.0 - ad) / ad).sqrt(), k_bright: core::f32::consts::FRAC_1_SQRT_2 }
    }
}

pub struct WavetableSynth {
    sample_rate: f32,
    tables: Vec<Wavetable>,
    voices: [Voice; MAX_VOICES],
    age: u64,
    rng: u32,
    until_tick: usize,
    layout: UnisonLayout,
    noise_filter: NoiseFilter,
    env1: Adsr,
    knobs: Knobs,
    matrix: ModMatrix,
    shadow: Shadow,
    global: GlobalMod,
    voicing: Voicing,
}

/// Mono/glide state. In mono mode voice 0 plays every note.
struct Voicing {
    mono: bool,
    legato: bool,
    /// Seconds.
    glide: f32,
    /// Keys held, oldest first; releasing the newest returns to the one before.
    held: [u8; MAX_HELD],
    held_len: usize,
    /// The mono voice was released by a note-off with nothing rendered since,
    /// so a note-on now (the sequencer's next step) still counts as legato.
    just_released: bool,
    /// The last mono note, to glide from once the voice has gone idle.
    last: Option<f32>,
}

const MAX_HELD: usize = 16;

impl Voicing {
    fn press(&mut self, note: u8) {
        self.release(note);
        if self.held_len == MAX_HELD {
            self.held.copy_within(1.., 0);
            self.held_len -= 1;
        }
        self.held[self.held_len] = note;
        self.held_len += 1;
    }

    fn release(&mut self, note: u8) {
        if let Some(i) = self.held[..self.held_len].iter().position(|&n| n == note) {
            self.held.copy_within(i + 1..self.held_len, i);
            self.held_len -= 1;
        }
    }

    fn top(&self) -> Option<u8> {
        self.held[..self.held_len].last().copied()
    }
}

impl WavetableSynth {
    pub fn new(sample_rate: f32) -> Self {
        // Smoother time constants are per control tick (CONTROL samples each).
        let rate = sample_rate / CONTROL as f32;
        let s = |v: f32, t: f32| Smoother::with_time(v, t, rate);
        Self {
            sample_rate,
            tables: builtin_tables(),
            voices: [Voice::idle(); MAX_VOICES],
            age: 0,
            rng: 0x9E37_79B9,
            until_tick: 0,
            layout: UnisonLayout::new(),
            noise_filter: NoiseFilter::new(sample_rate),
            env1: Adsr::new(0.005, 0.3, 0.7, 0.25, sample_rate),
            knobs: Knobs {
                a: OscKnobs::new(true, rate),
                b: OscKnobs::new(false, rate),
                x: ExtraKnobs {
                    sub_enabled: s(0.0, 0.005),
                    sub_level: s(0.5, 0.01),
                    sub_octave: -1.0,
                    sub_shape: 0,
                    noise_enabled: s(0.0, 0.005),
                    noise_level: s(0.25, 0.01),
                    noise_color: s(0.5, 0.02),
                    noise_to_filter: s(1.0, 0.005),
                },
                log_cutoff: s(4000.0f32.ln(), 0.01),
                resonance: s(0.2, 0.01),
                filter_mix: s(1.0, 0.01),
            },
            matrix: ModMatrix::new(sample_rate),
            shadow: Shadow { note: 60, env1: Envelope::IDLE, mods: ModVoice::IDLE },
            global: GlobalMod::NONE,
            voicing: Voicing { mono: false, legato: false, glide: 0.0, held: [0; MAX_HELD], held_len: 0, just_released: false, last: None },
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

    /// Frequency (Hz) of each unison voice of osc A (`osc` 0) or B (1) of the voice playing `note`.
    pub fn unison_freqs(&self, note: u8, osc: usize) -> Vec<f32> {
        let Some(v) = self.voices.iter().find(|v| v.active() && v.note == note) else { return Vec::new() };
        let o = if osc == 0 { &v.a } else { &v.b };
        o.inc[..o.n].iter().map(|i| i * self.sample_rate).collect()
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

    /// Mono: which voice, whether it starts fresh, whether the envelopes
    /// retrigger, and the pitch to glide from (None = start on the note).
    fn mono_voice(&self, note: u8) -> (usize, bool, bool, Option<f32>) {
        let v = &self.voices[0];
        let sounding = v.active();
        let legato = sounding && (v.gate || self.voicing.just_released);
        let glides = self.voicing.glide > 0.0 && (legato || !self.voicing.legato);
        let from = if !glides {
            None
        } else if sounding {
            Some(v.pitch)
        } else {
            self.voicing.last
        };
        // A legato note slides without a new attack; the same note again re-strikes.
        let retrigger = !legato || v.note == note;
        (0, !sounding, retrigger, from)
    }

    /// Semitones per control tick to cover `from -> note` in the glide time.
    fn glide_step(&self, from: f32, note: u8) -> f32 {
        let ticks = (self.voicing.glide * self.sample_rate / CONTROL as f32).max(1.0);
        (note as f32 - from) / ticks
    }

    fn set_mono(&mut self, mono: bool) {
        if mono != self.voicing.mono {
            self.voicing.mono = mono;
            self.all_notes_off();
        }
    }

    fn control_tick(&mut self) {
        // Knob smoothers are timed in control ticks: one step each.
        self.knobs.tick();

        let m = &self.matrix;
        // Shadow (global) context.
        self.shadow.env1.advance(&self.env1.params, CONTROL);
        self.shadow.mods.advance(m, CONTROL, &mut self.rng);
        self.global.active = m.active();
        self.global.offsets = [0.0; TARGET_SLOTS];
        if m.active() {
            m.offsets(&self.shadow.mods.sources(m, self.shadow.env1.level), &mut self.global.offsets);
        }

        let sr = self.sample_rate;
        let k = 1.0 / CONTROL as f32;
        for v in self.voices.iter_mut() {
            if !v.active() {
                continue;
            }
            v.mods.advance(m, CONTROL, &mut self.rng);
            if v.glide_step != 0.0 {
                v.pitch += v.glide_step;
                let target = v.note as f32;
                if (v.glide_step > 0.0) == (v.pitch >= target) {
                    v.pitch = target;
                    v.glide_step = 0.0;
                }
            }
            let t = voice_targets(&self.knobs, m, v, &self.layout, sr);
            for ((d, t), c) in v.dctl.iter_mut().zip(t.ctl).zip(v.ctl) {
                *d = (t - c) * k;
            }
            v.a.ramp(&t.a);
            v.b.ramp(&t.b);
            v.sub_inc = t.sub_inc;
            v.sub_mip = t.sub_mip;
        }
    }

    fn render_segment(&mut self, left: &mut [f32], right: &mut [f32]) {
        let m = left.len();
        debug_assert!(m <= CONTROL);
        let env = self.env1.params;
        let tables = &self.tables;
        let sub_pos = match self.knobs.x.sub_shape {
            0 => 0.0,
            1 => 5.0 / (FRAMES - 1) as f32, // the basic table's triangle frame (t = 1/3)
            _ => 1.0,
        };
        let nf = &self.noise_filter;
        for v in self.voices.iter_mut() {
            if !v.active() {
                continue;
            }
            // Ramp the shared control values once per sample.
            let mut cs = [[0.0f32; N_CTL]; CONTROL];
            let mut c = v.ctl;
            for row in cs.iter_mut().take(m) {
                for (x, d) in c.iter_mut().zip(v.dctl) {
                    *x += d;
                }
                *row = c;
            }
            let on = |i: usize| v.ctl[i] != 0.0 || v.dctl[i] != 0.0;
            let (a_on, b_on, sub_on, noise_on) = (on(C_GAIN_A), on(C_GAIN_B), on(C_GAIN_SUB), on(C_GAIN_N));
            v.ctl = c;

            // Filter bus (f) and around-the-filter bus (d), stereo.
            let mut fl = [0.0f32; CONTROL];
            let mut fr = [0.0f32; CONTROL];
            let mut dl = [0.0f32; CONTROL];
            let mut dr = [0.0f32; CONTROL];
            if a_on {
                let t = &tables[v.a.table];
                render_unison(&mut v.a, t, &cs[..m], C_POS_A, C_GAIN_A, C_TOF_A, [&mut fl, &mut fr, &mut dl, &mut dr]);
            }
            if b_on {
                let t = &tables[v.b.table];
                render_unison(&mut v.b, t, &cs[..m], C_POS_B, C_GAIN_B, C_TOF_B, [&mut fl, &mut fr, &mut dl, &mut dr]);
            }
            if sub_on {
                let t = &tables[0];
                let (b0, b1, ff) = t.frame_offsets(v.sub_mip, sub_pos);
                for i in 0..m {
                    let s = t.read(b0, b1, ff, v.sub_phase) * cs[i][C_GAIN_SUB];
                    v.sub_phase += v.sub_inc;
                    if v.sub_phase >= 1.0 {
                        v.sub_phase -= 1.0;
                    }
                    fl[i] += s;
                    fr[i] += s;
                }
            }
            if noise_on {
                let n = &mut v.noise;
                for i in 0..m {
                    let color = cs[i][C_COLOR];
                    let (ww, wd, wb) = if color < 0.5 {
                        let t = (0.5 - color) * 2.0;
                        (1.0 - t, t * nf.k_dark, 0.0)
                    } else {
                        let t = (color - 0.5) * 2.0;
                        (1.0 - t, 0.0, t * nf.k_bright)
                    };
                    let g = cs[i][C_GAIN_N];
                    let tof = cs[i][C_TOF_N];
                    let mut out = [0.0f32; 2];
                    for (ch, o) in out.iter_mut().enumerate() {
                        let w = rand01(&mut n.rng[ch]) * 2.0 - 1.0;
                        n.dark[ch] += nf.a_dark * (w - n.dark[ch]);
                        let diff = w - n.prev[ch];
                        n.prev[ch] = w;
                        *o = (ww * w + wd * n.dark[ch] + wb * diff) * g;
                    }
                    fl[i] += out[0] * tof;
                    fr[i] += out[1] * tof;
                    dl[i] += out[0] * (1.0 - tof);
                    dr[i] += out[1] * (1.0 - tof);
                }
            }

            for i in 0..m {
                let c = &cs[i];
                let c1 = SvfCoefs::new(c[C_G], c[C_K1]);
                let c2 = SvfCoefs::new(c[C_G], c[C_K2]);
                let yl = v.fl[0].lowpass(&c1, fl[i]);
                let yl = v.fl[1].lowpass(&c2, yl);
                let yr = v.fr[0].lowpass(&c1, fr[i]);
                let yr = v.fr[1].lowpass(&c2, yr);
                let mix = c[C_MIX];
                let amp = v.env.next(&env);
                left[i] += (fl[i] + (yl - fl[i]) * mix + dl[i]) * amp;
                right[i] += (fr[i] + (yr - fr[i]) * mix + dr[i]) * amp;
                if !v.active() {
                    break;
                }
            }
            if !v.active() {
                v.fl = [Svf::default(); 2];
                v.fr = [Svf::default(); 2];
            }
        }
    }
}

/// Render one oscillator's unison stack for a segment and add it to the filter
/// (`to_filter` share) and dry buses.
#[inline]
fn render_unison(
    o: &mut UniOsc,
    table: &Wavetable,
    cs: &[[f32; N_CTL]],
    pos: usize,
    gain: usize,
    tof: usize,
    [fl, fr, dl, dr]: [&mut [f32; CONTROL]; 4],
) {
    let m = cs.len();
    let mut offs = [(0usize, 0usize, 0.0f32); CONTROL];
    for (off, c) in offs.iter_mut().zip(cs) {
        *off = table.frame_offsets(o.mip, c[pos]);
    }
    let mut al = [0.0f32; CONTROL];
    let mut ar = [0.0f32; CONTROL];
    for u in 0..o.n_proc {
        let (mut ph, inc) = (o.phase[u], o.inc[u]);
        let (mut gl, mut gr, dgl, dgr) = (o.gl[u], o.gr[u], o.dgl[u], o.dgr[u]);
        for i in 0..m {
            let (b0, b1, ff) = offs[i];
            let s = table.read(b0, b1, ff, ph);
            ph += inc;
            if ph >= 1.0 {
                ph -= 1.0;
            }
            gl += dgl;
            gr += dgr;
            al[i] += s * gl;
            ar[i] += s * gr;
        }
        o.phase[u] = ph;
        o.gl[u] = gl;
        o.gr[u] = gr;
    }
    for i in 0..m {
        let g = cs[i][gain];
        let t = cs[i][tof];
        let (l, r) = (al[i] * g, ar[i] * g);
        fl[i] += l * t;
        fr[i] += r * t;
        dl[i] += l * (1.0 - t);
        dr[i] += r * (1.0 - t);
    }
}

impl Instrument for WavetableSynth {
    fn note_on(&mut self, note: u8, velocity: f32) {
        if velocity <= 0.0 {
            self.note_off(note);
            return;
        }
        let (i, fresh, retrigger, from) = if self.voicing.mono {
            self.voicing.press(note);
            self.mono_voice(note)
        } else {
            let (i, fresh) = self.pick_voice(note);
            (i, fresh, true, None)
        };
        let step = from.map_or(0.0, |f| self.glide_step(f, note));
        self.age += 1;
        self.voicing.just_released = false;
        if self.voicing.mono {
            self.voicing.last = Some(note as f32);
        }
        let sr = self.sample_rate;
        let v = &mut self.voices[i];
        if fresh {
            *v = Voice::idle();
        }
        match from {
            Some(f) if step != 0.0 => {
                v.pitch = f;
                v.glide_step = step;
            }
            _ => {
                v.pitch = note as f32;
                v.glide_step = 0.0;
            }
        }
        // Stolen/retriggered voices keep phases, filter state, env level and
        // control values so there is no discontinuity; the attack ramps from
        // the current level and the next control tick glides to the new values.
        v.note = note;
        v.velocity = velocity.clamp(0.0, 1.0);
        v.gate = true;
        v.age = self.age;
        if retrigger {
            v.env.gate_on();
            v.mods.trigger(note, v.velocity, &mut self.rng);
        }
        if fresh {
            let k = &self.knobs;
            v.a.start(k.a.phase, k.a.random_phase, &mut self.rng);
            v.b.start(k.b.phase, k.b.random_phase, &mut self.rng);
            v.noise.rng = [self.rng | 1, self.rng.rotate_left(16) | 1];
            rand01(&mut self.rng);
            let t = voice_targets(k, &self.matrix, v, &self.layout, sr);
            v.ctl = t.ctl;
            v.a.set(&t.a);
            v.b.set(&t.b);
            v.sub_inc = t.sub_inc;
            v.sub_mip = t.sub_mip;
        }
        self.shadow = Shadow { note, env1: v.env, mods: v.mods };
    }

    fn note_off(&mut self, note: u8) {
        if self.voicing.mono {
            self.voicing.release(note);
            let back = self.voicing.top();
            let v = &self.voices[0];
            if v.gate && v.note == note {
                if let Some(prev) = back {
                    // Still holding an earlier key: slide back to it, legato.
                    let step = if self.voicing.glide > 0.0 { self.glide_step(v.pitch, prev) } else { 0.0 };
                    let v = &mut self.voices[0];
                    v.note = prev;
                    v.glide_step = step;
                    if step == 0.0 {
                        v.pitch = prev as f32;
                    }
                    self.voicing.last = Some(prev as f32);
                    self.shadow.note = prev;
                    return;
                }
                self.voicing.just_released = true;
            }
        }
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
        self.voicing.held_len = 0;
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
        self.apply_param(id, value);
        // Nothing sounding: no need to glide, so a freshly loaded patch starts exactly.
        if self.voices.iter().all(|v| !v.active()) {
            self.knobs.snap();
        }
    }

    fn render(&mut self, left: &mut [f32], right: &mut [f32]) {
        self.render_impl(left, right);
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

impl WavetableSynth {
    fn apply_param(&mut self, id: u32, value: f32) {
        let sr = self.sample_rate;
        let n_tables = self.tables.len();
        let table = |v: f32| (v.round().max(0.0) as usize).min(n_tables - 1);
        let on = |v: f32| if v >= 0.5 { 1.0 } else { 0.0 };
        let k = &mut self.knobs;
        match id {
            OSC_A_TABLE => k.a.table = table(value),
            OSC_A_POSITION => k.a.position.target = value.clamp(0.0, 1.0),
            OSC_A_LEVEL => k.a.level.target = value.clamp(0.0, 1.0),
            OSC_A_OCTAVE => k.a.octave = value.round().clamp(-4.0, 4.0),
            OSC_A_SEMI => k.a.semi = value.round().clamp(-12.0, 12.0),
            OSC_A_FINE => k.a.fine = value.clamp(-100.0, 100.0),
            FILTER_CUTOFF => k.log_cutoff.target = value.clamp(20.0, 20000.0).ln(),
            FILTER_RESONANCE => k.resonance.target = value.clamp(0.0, 1.0),
            FILTER_ENABLED => k.filter_mix.target = on(value),
            ENV1_ATTACK => self.env1.set(0, value, sr),
            ENV1_DECAY => self.env1.set(1, value, sr),
            ENV1_SUSTAIN => self.env1.set(2, value, sr),
            ENV1_RELEASE => self.env1.set(3, value, sr),
            OSC_A_ENABLED => k.a.enabled.target = on(value),
            _ if (OSC_A_VOICE..OSC_A_VOICE + 8).contains(&id) => k.a.set_voice_param(id - OSC_A_VOICE, value),
            OSC_B_ENABLED => k.b.enabled.target = on(value),
            OSC_B_TABLE => k.b.table = table(value),
            OSC_B_POSITION => k.b.position.target = value.clamp(0.0, 1.0),
            OSC_B_LEVEL => k.b.level.target = value.clamp(0.0, 1.0),
            OSC_B_OCTAVE => k.b.octave = value.round().clamp(-4.0, 4.0),
            OSC_B_SEMI => k.b.semi = value.round().clamp(-12.0, 12.0),
            OSC_B_FINE => k.b.fine = value.clamp(-100.0, 100.0),
            _ if (OSC_B_VOICE..OSC_B_VOICE + 8).contains(&id) => k.b.set_voice_param(id - OSC_B_VOICE, value),
            SUB_ENABLED => k.x.sub_enabled.target = on(value),
            SUB_LEVEL => k.x.sub_level.target = value.clamp(0.0, 1.0),
            SUB_OCTAVE => k.x.sub_octave = value.round().clamp(-2.0, 0.0),
            SUB_SHAPE => k.x.sub_shape = (value.round().max(0.0) as usize).min(2),
            NOISE_ENABLED => k.x.noise_enabled.target = on(value),
            NOISE_LEVEL => k.x.noise_level.target = value.clamp(0.0, 1.0),
            NOISE_COLOR => k.x.noise_color.target = value.clamp(0.0, 1.0),
            NOISE_TO_FILTER => k.x.noise_to_filter.target = on(value),
            VOICE_MODE => self.set_mono(value >= 0.5),
            VOICE_LEGATO => self.voicing.legato = value >= 0.5,
            GLIDE_TIME => self.voicing.glide = value.clamp(0.0, 2.0),
            _ => {}
        }
    }

    fn render_impl(&mut self, left: &mut [f32], right: &mut [f32]) {
        let n = left.len().min(right.len());
        if n > 0 {
            self.voicing.just_released = false;
        }
        left[..n].fill(0.0);
        right[..n].fill(0.0);
        let mut pos = 0;
        while pos < n {
            if self.until_tick == 0 {
                self.finish_tick();
                self.control_tick();
                self.until_tick = CONTROL;
            }
            let m = (n - pos).min(self.until_tick);
            self.render_segment(&mut left[pos..pos + m], &mut right[pos..pos + m]);
            self.until_tick -= m;
            pos += m;
        }
    }

    /// End of a control tick: unison voices that faded out are dropped.
    fn finish_tick(&mut self) {
        for v in self.voices.iter_mut() {
            v.a.n_proc = v.a.n;
            v.b.n_proc = v.b.n;
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

    #[test]
    fn unison_layout_is_symmetric_at_the_ends() {
        let l = UnisonLayout::new();
        for n in 2..=MAX_UNISON {
            assert_eq!(l.x[n][0], -1.0);
            assert_eq!(l.x[n][n - 1], 1.0);
            assert_eq!(l.center[n].iter().filter(|&&c| c).count(), if n % 2 == 1 { 1 } else { 2 });
            for u in 1..n {
                assert!(l.x[n][u] > l.x[n][u - 1], "n {n} not monotonic");
            }
        }
    }

    #[test]
    fn semitone_ratio_is_accurate() {
        for s in [-1.0f32, -0.3, 0.0, 0.5, 1.0] {
            let exact = (s / 12.0).exp2();
            assert!((semitone_ratio(s) / exact - 1.0).abs() < 1e-6, "{s}");
        }
    }

    fn hz(note: f32) -> f32 {
        440.0 * ((note - 69.0) / 12.0).exp2()
    }

    fn render_ms(s: &mut WavetableSynth, ms: usize) {
        let n = 48 * ms;
        let (mut l, mut r) = (vec![0.0; n], vec![0.0; n]);
        s.render(&mut l, &mut r);
    }

    fn mono(glide: f32, legato: bool) -> WavetableSynth {
        let mut s = WavetableSynth::new(48000.0);
        s.set_param(VOICE_MODE, 1.0);
        s.set_param(VOICE_LEGATO, if legato { 1.0 } else { 0.0 });
        s.set_param(GLIDE_TIME, glide);
        s
    }

    #[test]
    fn poly_ignores_glide() {
        let mut s = WavetableSynth::new(48000.0);
        s.set_param(GLIDE_TIME, 0.1);
        s.note_on(48, 1.0);
        render_ms(&mut s, 10);
        s.note_on(60, 1.0);
        render_ms(&mut s, 1);
        assert_eq!(s.active_voices(), 2);
        assert!((s.unison_freqs(60, 0)[0] / hz(60.0) - 1.0).abs() < 1e-3);
    }

    #[test]
    fn mono_legato_glides_between_held_notes() {
        let mut s = mono(0.1, true);
        s.note_on(48, 1.0);
        render_ms(&mut s, 20);
        s.note_on(60, 1.0);
        assert_eq!(s.active_voices(), 1);
        render_ms(&mut s, 50);
        let mid = s.unison_freqs(60, 0)[0];
        assert!(mid > hz(52.0) && mid < hz(57.0), "halfway through the glide, got {mid}");
        render_ms(&mut s, 60);
        assert!((s.unison_freqs(60, 0)[0] / hz(60.0) - 1.0).abs() < 1e-3);
        // Releasing the top key slides back to the one still held.
        s.note_off(60);
        render_ms(&mut s, 120);
        assert!((s.unison_freqs(48, 0)[0] / hz(48.0) - 1.0).abs() < 1e-3);
        assert!(s.voices[0].gate);
    }

    #[test]
    fn mono_legato_glides_across_touching_sequencer_steps() {
        let mut s = mono(0.1, true);
        s.note_on(48, 1.0);
        render_ms(&mut s, 20);
        // A step boundary: the old note's off, then the new note's on, same sample.
        s.note_off(48);
        s.note_on(60, 1.0);
        render_ms(&mut s, 50);
        let mid = s.unison_freqs(60, 0)[0];
        assert!(mid < hz(58.0), "should still be gliding, got {mid}");
    }

    #[test]
    fn mono_legato_detached_notes_jump() {
        let mut s = mono(0.1, true);
        s.set_param(ENV1_RELEASE, 0.5);
        s.note_on(48, 1.0);
        render_ms(&mut s, 20);
        s.note_off(48);
        render_ms(&mut s, 5);
        s.note_on(60, 1.0);
        render_ms(&mut s, 1);
        assert!((s.unison_freqs(60, 0)[0] / hz(60.0) - 1.0).abs() < 1e-3);
    }

    #[test]
    fn mono_always_glides_even_detached() {
        let mut s = mono(0.1, false);
        s.note_on(48, 1.0);
        render_ms(&mut s, 20);
        s.note_off(48);
        render_ms(&mut s, 500);
        assert_eq!(s.active_voices(), 0);
        s.note_on(60, 1.0);
        render_ms(&mut s, 50);
        let mid = s.unison_freqs(60, 0)[0];
        assert!(mid > hz(52.0) && mid < hz(57.0), "got {mid}");
    }
}
