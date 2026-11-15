//! Sound sources: unison, osc B, sub, noise (IDs 131..163).
use osc8_engine::engine::{render_offline, Engine, Event};
use osc8_engine::instrument::Instrument;
use osc8_engine::modulation::src;
use osc8_engine::params::*;
use osc8_engine::synth::WavetableSynth;
use std::f32::consts::PI;

const SR: f32 = 48000.0;

fn slot(s: u32, field: u32) -> u32 {
    MOD_BASE + s * MOD_STRIDE + field
}
fn route(s: u32, source: usize, target: u32, amount: f32) -> Vec<(u32, f32)> {
    vec![(slot(s, MOD_SOURCE), source as f32), (slot(s, MOD_TARGET), target as f32), (slot(s, MOD_AMOUNT), amount), (slot(s, MOD_AUX), 0.0)]
}
fn free_lfo(i: u32, hz: f32) -> Vec<(u32, f32)> {
    let b = LFO_BASE + i * LFO_STRIDE;
    vec![(b + LFO_SHAPE, 0.0), (b + LFO_SYNC, 0.0), (b + LFO_RATE, hz)]
}

fn render(params: &[(u32, f32)], notes: &[u8], frames: usize) -> (Vec<f32>, Vec<f32>) {
    let mut ev: Vec<(usize, Event)> = vec![(0, Event::Param(ENV1_ATTACK, 0.0)), (0, Event::Param(ENV1_SUSTAIN, 1.0)), (0, Event::Param(MASTER_VOLUME, 0.5))];
    ev.extend(params.iter().map(|&(id, v)| (0, Event::Param(id, v))));
    ev.extend(notes.iter().map(|&n| (0, Event::NoteOn(n, 1.0))));
    render_offline(SR, &ev, frames)
}

fn rms(x: &[f32]) -> f32 {
    (x.iter().map(|v| (*v as f64).powi(2)).sum::<f64>() / x.len() as f64).sqrt() as f32
}
fn db(a: f32, b: f32) -> f32 {
    20.0 * (a / b).log10()
}
fn brightness(x: &[f32]) -> f32 {
    x.windows(2).map(|w| (w[1] - w[0]).powi(2)).sum::<f32>() / x.iter().map(|v| v * v).sum::<f32>().max(1e-12)
}
fn correlation(a: &[f32], b: &[f32]) -> f32 {
    let (mut ab, mut aa, mut bb) = (0.0f64, 0.0f64, 0.0f64);
    for (x, y) in a.iter().zip(b) {
        ab += (*x as f64) * (*y as f64);
        aa += (*x as f64).powi(2);
        bb += (*y as f64).powi(2);
    }
    (ab / (aa * bb).sqrt()) as f32
}
/// Frequency from upward zero crossings (for clean, near-sinusoidal signals).
fn pitch(x: &[f32]) -> f32 {
    let ups: Vec<f32> = (1..x.len())
        .filter(|&i| x[i - 1] < 0.0 && x[i] >= 0.0)
        .map(|i| (i - 1) as f32 + x[i - 1] / (x[i - 1] - x[i]))
        .collect();
    (ups.len() - 1) as f32 / (ups[ups.len() - 1] - ups[0]) * SR
}
/// Goertzel power at `freq`.
fn power_at(x: &[f32], freq: f32) -> f32 {
    let w = 2.0 * PI as f64 * freq as f64 / SR as f64;
    let c = 2.0 * w.cos();
    let (mut s1, mut s2) = (0.0f64, 0.0f64);
    for &v in x {
        let s = v as f64 + c * s1 - s2;
        s2 = s1;
        s1 = s;
    }
    ((s1 * s1 + s2 * s2 - c * s1 * s2) / (x.len() as f64).powi(2)) as f32
}

const SINE: [(u32, f32); 2] = [(OSC_A_POSITION, 0.0), (FILTER_ENABLED, 0.0)];
const SAW: [(u32, f32); 2] = [(OSC_A_POSITION, 0.67), (FILTER_ENABLED, 0.0)];
const A_OFF: (u32, f32) = (OSC_A_ENABLED, 0.0);

#[test]
fn ids_match_params_ts() {
    let expect = [
        (OSC_A_ENABLED, 131), (OSC_A_PAN, 132), (OSC_A_UNISON, 133), (OSC_A_DETUNE, 134), (OSC_A_BLEND, 135),
        (OSC_A_SPREAD, 136), (OSC_A_PHASE, 137), (OSC_A_RANDOM_PHASE, 138), (OSC_A_TO_FILTER, 139),
        (OSC_B_ENABLED, 140), (OSC_B_TABLE, 141), (OSC_B_POSITION, 142), (OSC_B_LEVEL, 143), (OSC_B_OCTAVE, 144),
        (OSC_B_SEMI, 145), (OSC_B_FINE, 146), (OSC_B_PAN, 147), (OSC_B_UNISON, 148), (OSC_B_DETUNE, 149),
        (OSC_B_BLEND, 150), (OSC_B_SPREAD, 151), (OSC_B_PHASE, 152), (OSC_B_RANDOM_PHASE, 153), (OSC_B_TO_FILTER, 154),
        (SUB_ENABLED, 156), (SUB_LEVEL, 157), (SUB_OCTAVE, 158), (SUB_SHAPE, 159),
        (NOISE_ENABLED, 160), (NOISE_LEVEL, 161), (NOISE_COLOR, 162), (NOISE_TO_FILTER, 163),
    ];
    for (id, n) in expect {
        assert_eq!(id, n);
    }
    assert_eq!(PARAM_COUNT, 175);
}

#[test]
fn unison_one_is_the_mono_single_voice_path() {
    let (l, r) = render(&SINE, &[69], 48000);
    assert_eq!(l, r, "mono");
    assert!((pitch(&l[4800..]) - 440.0).abs() < 0.05, "{}", pitch(&l[4800..]));
    // Spread 0 keeps a 7-voice stack mono too.
    let mut p = SAW.to_vec();
    p.extend([(OSC_A_UNISON, 7.0), (OSC_A_SPREAD, 0.0)]);
    let (l, r) = render(&p, &[57], 24000);
    assert_eq!(l, r);
}

#[test]
fn unison_spread_decorrelates_left_and_right() {
    let mut p = SAW.to_vec();
    p.extend([(OSC_A_UNISON, 7.0), (OSC_A_SPREAD, 1.0), (OSC_A_DETUNE, 0.3), (OSC_A_BLEND, 1.0)]);
    let (l, r) = render(&p, &[57], 96000);
    let c = correlation(&l[9600..], &r[9600..]);
    assert!(c < 0.5, "correlation {c}");
    // Half the spread is clearly narrower but still stereo.
    p.push((OSC_A_SPREAD, 0.5));
    let (l, r) = render(&p, &[57], 96000);
    let half = correlation(&l[9600..], &r[9600..]);
    assert!(half > c + 0.1 && half < 0.95, "half spread {half}");
}

#[test]
fn detune_widens_the_spectrum_symmetrically() {
    let mut s = WavetableSynth::new(SR);
    s.set_param(OSC_A_UNISON, 5.0);
    s.set_param(OSC_A_DETUNE, 0.5);
    s.note_on(69, 1.0);
    let f = s.unison_freqs(69, 0);
    assert_eq!(f.len(), 5);
    let semis: Vec<f32> = f.iter().map(|x| 12.0 * (x / 440.0).log2()).collect();
    assert!((semis[0] + 0.5).abs() < 1e-3 && (semis[4] - 0.5).abs() < 1e-3, "{semis:?}");
    assert!(semis[2].abs() < 1e-3);
    // Inner voices are jittered off the linear grid (no lockstep beating), but stay ordered.
    assert!((semis[1] + 0.25).abs() > 1e-3);

    // Spectrum: with detune 0 the energy sits on the fundamental; detuned, it spreads around it.
    let near_fraction = |detune: f32| {
        let mut p = SINE.to_vec();
        p.extend([(OSC_A_UNISON, 7.0), (OSC_A_DETUNE, detune), (OSC_A_RANDOM_PHASE, 0.0)]);
        let (l, _) = render(&p, &[69], 96000);
        let x = &l[48000..];
        2.0 * power_at(x, 440.0) / rms(x).powi(2)
    };
    let tight = near_fraction(0.0);
    let wide = near_fraction(0.6);
    assert!(tight > 0.9, "tight {tight}");
    assert!(wide < 0.4, "wide {wide}");
}

#[test]
fn unison_level_is_stable_from_1_to_16_voices() {
    let level = |n: f32| {
        let mut p = SAW.to_vec();
        p.extend([(OSC_A_UNISON, n), (OSC_A_DETUNE, 0.5), (OSC_A_BLEND, 0.75), (OSC_A_SPREAD, 0.5)]);
        let (l, r) = render(&p, &[69], 48000 * 3);
        (rms(&l[24000..]) + rms(&r[24000..])) / 2.0
    };
    let one = level(1.0);
    for n in [2.0, 3.0, 5.0, 8.0, 12.0, 16.0] {
        let d = db(level(n), one);
        assert!(d.abs() < 2.0, "{n} voices: {d:+.2} dB");
    }
}

#[test]
fn osc_b_mixes_and_to_filter_bypasses() {
    let b_only = |to_filter: f32| {
        let p = [A_OFF, (OSC_B_ENABLED, 1.0), (OSC_B_POSITION, 0.67), (OSC_B_TO_FILTER, to_filter), (FILTER_CUTOFF, 150.0), (FILTER_RESONANCE, 0.0)];
        render(&p, &[57], 24000).0
    };
    let filtered = b_only(1.0);
    let bypass = b_only(0.0);
    assert!(rms(&bypass[4800..]) > 0.05);
    assert!(brightness(&bypass[4800..]) > brightness(&filtered[4800..]) * 10.0);
    // A + B sum: louder than either alone.
    let a = render(&SAW, &[57], 24000).0;
    let mut p = SAW.to_vec();
    p.extend([(OSC_B_ENABLED, 1.0), (OSC_B_POSITION, 0.67), (OSC_B_SEMI, 7.0)]);
    let ab = render(&p, &[57], 24000).0;
    assert!(rms(&ab[4800..]) > rms(&a[4800..]) * 1.2);
    // B follows its own tuning: a sine on B, one octave up.
    let p = [A_OFF, (OSC_B_ENABLED, 1.0), (OSC_B_OCTAVE, 1.0), (FILTER_ENABLED, 0.0)];
    assert!((pitch(&render(&p, &[57], 24000).0[4800..]) - 440.0).abs() < 0.1);
}

#[test]
fn sub_is_below_osc_a_and_follows_its_pitch() {
    let sub = |octave: f32, semi: f32| {
        let p = [A_OFF, (SUB_ENABLED, 1.0), (SUB_LEVEL, 1.0), (SUB_OCTAVE, octave), (SUB_SHAPE, 0.0), (OSC_A_SEMI, semi), (FILTER_ENABLED, 0.0)];
        let (l, r) = render(&p, &[69], 48000);
        assert_eq!(l, r, "sub is mono");
        pitch(&l[4800..])
    };
    assert!((sub(-1.0, 0.0) - 220.0).abs() < 0.05);
    assert!((sub(-2.0, 0.0) - 110.0).abs() < 0.05);
    assert!((sub(-1.0, 12.0) - 440.0).abs() < 0.1);
    // Square and triangle shapes are band-limited and audible.
    for shape in [1.0, 2.0] {
        let p = [A_OFF, (SUB_ENABLED, 1.0), (SUB_SHAPE, shape), (FILTER_ENABLED, 0.0)];
        let (l, _) = render(&p, &[45], 24000);
        assert!(rms(&l[4800..]) > 0.05 && l.iter().all(|v| v.is_finite()));
    }
}

#[test]
fn noise_color_tilts_the_spectrum() {
    let noise = |color: f32| {
        let p = [A_OFF, (NOISE_ENABLED, 1.0), (NOISE_LEVEL, 0.5), (NOISE_COLOR, color), (NOISE_TO_FILTER, 0.0)];
        let (l, r) = render(&p, &[60], 48000);
        assert!(correlation(&l[4800..], &r[4800..]).abs() < 0.1, "stereo noise");
        (brightness(&l[4800..]), rms(&l[4800..]))
    };
    let (dark, dark_rms) = noise(0.0);
    let (white, white_rms) = noise(0.5);
    let (bright, bright_rms) = noise(1.0);
    assert!(dark < white * 0.2 && white < bright * 0.8, "{dark} {white} {bright}");
    assert!(db(dark_rms, white_rms).abs() < 3.0 && db(bright_rms, white_rms).abs() < 3.0);
    // toFilter routes it through the filter.
    let p = [A_OFF, (NOISE_ENABLED, 1.0), (NOISE_TO_FILTER, 1.0), (FILTER_CUTOFF, 200.0)];
    let filtered = brightness(&render(&p, &[60], 24000).0[4800..]);
    assert!(filtered < white * 0.05);
}

#[test]
fn osc_a_enabled_gates_even_a_level_mod_route() {
    let mut p = vec![A_OFF, (ENV_BASE, 0.0), (ENV_BASE + 1, 0.0), (ENV_BASE + 2, 1.0)];
    p.extend(route(0, src::ENV2, OSC_A_LEVEL, 1.0));
    let (l, r) = render(&p, &[60], 24000);
    assert!(l[2400..].iter().chain(&r[2400..]).all(|&v| v == 0.0));
}

#[test]
fn new_mod_targets_move() {
    let targets = [
        OSC_A_PAN, OSC_A_DETUNE, OSC_A_BLEND, OSC_A_SPREAD, OSC_B_POSITION, OSC_B_LEVEL, OSC_B_PAN, OSC_B_SEMI,
        OSC_B_FINE, OSC_B_DETUNE, SUB_LEVEL, NOISE_LEVEL, NOISE_COLOR,
    ];
    let mut e = Engine::new(SR);
    for (id, v) in free_lfo(0, 3.0) {
        e.set_param(id, v);
    }
    for (s, &t) in targets.iter().enumerate() {
        for (id, v) in route(s as u32, src::LFO1, t, 0.3) {
            e.set_param(id, v);
        }
    }
    e.note_on(60, 1.0);
    let mut lo = [f32::MAX; 13];
    let mut hi = [f32::MIN; 13];
    for _ in 0..375 {
        e.process(128);
        for (k, &t) in targets.iter().enumerate() {
            lo[k] = lo[k].min(e.mod_values[t as usize]);
            hi[k] = hi[k].max(e.mod_values[t as usize]);
        }
    }
    for (k, &t) in targets.iter().enumerate() {
        assert!(hi[k] > lo[k], "target {t} did not move");
    }

    // Audibly: an LFO on oscA.pan swings the balance; on oscA.detune it changes the stack.
    let mut p = SAW.to_vec();
    p.extend(free_lfo(0, 2.0));
    p.extend(route(0, src::LFO1, OSC_A_PAN, 0.5));
    let (l, r) = render(&p, &[57], 48000);
    let bal = |t: usize| db(rms(&l[t..t + 2400]), rms(&r[t..t + 2400]));
    // LFO peak (pan right) at 0.125 s, trough (left) at 0.375 s.
    assert!(bal(4800) < -3.0 && bal(16800) > 3.0, "{} {}", bal(4800), bal(16800));
    let mut s = WavetableSynth::new(SR);
    s.set_param(OSC_A_UNISON, 3.0);
    s.set_param(OSC_A_DETUNE, 0.0);
    for (id, v) in [ENV_BASE, ENV_BASE + 1, ENV_BASE + 2].into_iter().zip([0.0, 0.0, 1.0]).chain(route(0, src::ENV2, OSC_A_DETUNE, 0.5)) {
        s.set_param(id, v);
    }
    s.note_on(69, 1.0);
    let (mut bl, mut br) = (vec![0.0; 960], vec![0.0; 960]);
    s.render(&mut bl, &mut br);
    let f = s.unison_freqs(69, 0);
    assert!((12.0 * (f[2] / 440.0).log2() - 0.5).abs() < 1e-3, "{f:?}");
}

#[test]
fn stress_everything_maxed() {
    let mut p: Vec<(u32, f32)> = vec![
        (OSC_A_UNISON, 16.0), (OSC_A_DETUNE, 1.0), (OSC_A_SPREAD, 1.0), (OSC_A_BLEND, 1.0), (OSC_A_LEVEL, 1.0), (OSC_A_TABLE, 4.0),
        (OSC_B_ENABLED, 1.0), (OSC_B_UNISON, 16.0), (OSC_B_DETUNE, 1.0), (OSC_B_SPREAD, 1.0), (OSC_B_LEVEL, 1.0), (OSC_B_TABLE, 3.0),
        (OSC_B_TO_FILTER, 0.0), (SUB_ENABLED, 1.0), (SUB_LEVEL, 1.0), (SUB_SHAPE, 2.0), (NOISE_ENABLED, 1.0), (NOISE_LEVEL, 1.0),
        (FILTER_RESONANCE, 1.0), (MASTER_VOLUME, 1.0),
        (FX_DIST_ENABLED, 1.0), (FX_DIST_DRIVE, 1.0), (FX_CHORUS_ENABLED, 1.0), (FX_DELAY_ENABLED, 1.0), (FX_DELAY_FEEDBACK, 1.0),
        (FX_REVERB_ENABLED, 1.0), (FX_REVERB_DECAY, 1.0), (FX_OTT_ENABLED, 1.0), (FX_OTT_DEPTH, 1.0), (FX_EQ_ENABLED, 1.0), (FX_EQ_LOW, 12.0),
    ];
    for i in 0..4 {
        p.extend(free_lfo(i, 50.0 - 10.0 * i as f32));
    }
    let targets = [
        OSC_A_POSITION, OSC_A_PAN, OSC_A_DETUNE, OSC_A_SPREAD, OSC_B_POSITION, OSC_B_SEMI, OSC_B_DETUNE, SUB_LEVEL,
        NOISE_COLOR, FILTER_CUTOFF, FILTER_RESONANCE, MASTER_VOLUME, FX_DIST_DRIVE, FX_REVERB_SIZE, FX_DELAY_FEEDBACK, FX_EQ_HIGH,
    ];
    for (s, &t) in targets.iter().enumerate() {
        p.extend(route(s as u32, src::LFO1 + s % 4, t, if s % 2 == 0 { 1.0 } else { -1.0 }));
    }
    let (l, r) = render(&p, &[24, 36, 48, 60, 72, 84, 96, 108], 48000 * 2);
    for x in l.iter().chain(&r) {
        assert!(x.is_finite() && x.abs() <= 1.0);
    }
    assert!(rms(&l) > 0.01);
}

