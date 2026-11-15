use osc8_engine::engine::{render_offline, Event};
use osc8_engine::fx::FxChain;
use osc8_engine::params::*;
use std::f32::consts::PI;

const SR: f32 = 48000.0;

fn rms(x: &[f32]) -> f32 {
    (x.iter().map(|v| v * v).sum::<f32>() / x.len().max(1) as f32).sqrt()
}

fn peak(x: &[f32]) -> f32 {
    x.iter().fold(0.0f32, |m, v| m.max(v.abs()))
}

fn sine(freq: f32, amp: f32, n: usize) -> Vec<f32> {
    (0..n).map(|i| amp * (2.0 * PI * freq * i as f32 / SR).sin()).collect()
}

/// Run a stereo signal through the chain in 128-frame blocks.
fn run(chain: &mut FxChain, l: &[f32], r: &[f32]) -> (Vec<f32>, Vec<f32>) {
    let (mut ol, mut or) = (l.to_vec(), r.to_vec());
    for (bl, br) in ol.chunks_mut(128).zip(or.chunks_mut(128)) {
        chain.process(bl, br);
    }
    (ol, or)
}

fn chain_with(params: &[(u32, f32)]) -> FxChain {
    let mut c = FxChain::new(SR);
    for &(id, v) in params {
        assert!(c.set_param(id, v), "id {id} not routed");
    }
    c
}

/// Goertzel magnitude of `freq` in `x`.
fn magnitude(x: &[f32], freq: f32) -> f32 {
    let w = 2.0 * PI * freq / SR;
    let (mut s1, mut s2) = (0.0f64, 0.0f64);
    let c = 2.0 * (w as f64).cos();
    for &v in x {
        let s = v as f64 + c * s1 - s2;
        s2 = s1;
        s1 = s;
    }
    ((s1 * s1 + s2 * s2 - c * s1 * s2).sqrt() / x.len() as f64) as f32
}

/// THD+N: everything that isn't the fundamental, relative to the fundamental.
/// (Bitcrush's sample-rate reduction aliases to inharmonic partials, so a
/// harmonics-only THD would undercount it.)
fn thd(x: &[f32], f0: f32) -> f32 {
    let fund_power = 2.0 * magnitude(x, f0).powi(2);
    let total = rms(x).powi(2);
    ((total - fund_power).max(0.0) / fund_power).sqrt()
}

/// Each effect enabled alone with strong settings, at full mix.
fn solo_settings() -> Vec<(&'static str, Vec<(u32, f32)>)> {
    vec![
        ("distortion", vec![(FX_DIST_TYPE, 2.0), (FX_DIST_DRIVE, 1.0), (FX_DIST_MIX, 1.0), (FX_DIST_ENABLED, 1.0)]),
        ("chorus", vec![(FX_CHORUS_RATE, 10.0), (FX_CHORUS_DEPTH, 1.0), (FX_CHORUS_MIX, 1.0), (FX_CHORUS_ENABLED, 1.0)]),
        ("delay", vec![(FX_DELAY_TIME, 3.0), (FX_DELAY_FEEDBACK, 1.0), (FX_DELAY_MIX, 1.0), (FX_DELAY_PING_PONG, 1.0), (FX_DELAY_ENABLED, 1.0)]),
        ("reverb", vec![(FX_REVERB_SIZE, 1.0), (FX_REVERB_DECAY, 1.0), (FX_REVERB_DAMPING, 0.0), (FX_REVERB_MIX, 1.0), (FX_REVERB_ENABLED, 1.0)]),
        ("ott", vec![(FX_OTT_DEPTH, 1.0), (FX_OTT_TIME, 0.0), (FX_OTT_ENABLED, 1.0)]),
        ("eq", vec![(FX_EQ_LOW, 12.0), (FX_EQ_MID, 12.0), (FX_EQ_HIGH, 12.0), (FX_EQ_ENABLED, 1.0)]),
    ]
}

fn synth_events() -> Vec<(usize, Event)> {
    let mut ev = vec![
        (0, Event::Param(OSC_A_POSITION, 0.67)),
        (0, Event::Param(OSC_A_LEVEL, 1.0)),
        (0, Event::Param(MASTER_VOLUME, 1.0)),
        (0, Event::Param(ENV1_RELEASE, 0.05)),
    ];
    for (i, n) in [36u8, 48, 55, 60, 64, 67, 72, 79].iter().enumerate() {
        ev.push((i * 31, Event::NoteOn(*n, 1.0)));
    }
    for n in [36u8, 48, 55, 60, 64, 67, 72, 79] {
        ev.push((48000, Event::NoteOff(n)));
    }
    ev
}

#[test]
fn every_param_id_is_routed() {
    let mut c = FxChain::new(SR);
    for id in FX_FIRST..PARAM_COUNT {
        assert!(c.set_param(id, 0.0), "fx id {id}");
    }
    for id in 0..FX_FIRST {
        assert!(!c.set_param(id, 0.0), "synth id {id} swallowed by fx");
    }
}

#[test]
fn each_effect_alone_is_finite_and_bounded() {
    for (name, settings) in solo_settings() {
        // Through the whole engine (soft clipped).
        let mut ev: Vec<(usize, Event)> = settings.iter().map(|&(id, v)| (0, Event::Param(id, v))).collect();
        ev.extend(synth_events());
        ev.sort_by_key(|e| e.0);
        let (l, r) = render_offline(SR, &ev, 96000);
        for x in l.iter().chain(r.iter()) {
            assert!(x.is_finite() && x.abs() <= 1.0, "{name}: {x}");
        }
        assert!(rms(&l) > 0.01, "{name} silent");
        // The chain alone (before the clipper) on a full-scale input stays finite and sane.
        let mut c = chain_with(&settings);
        let saw: Vec<f32> = (0..96000).map(|i| ((i as f32 * 110.0 / SR) % 1.0) * 2.0 - 1.0).collect();
        let (l, r) = run(&mut c, &saw, &saw);
        assert!(l.iter().chain(r.iter()).all(|x| x.is_finite()), "{name} non-finite");
        assert!(peak(&l).max(peak(&r)) < 16.0, "{name} peak {}", peak(&l));
    }
}

#[test]
fn disabled_effects_are_a_no_op() {
    // Every FX param at an extreme, but every effect disabled: bit-identical to no FX at all.
    let mut base = synth_events();
    base.sort_by_key(|e| e.0);
    let (dl, dr) = render_offline(SR, &base, 48000);
    let mut ev = Vec::new();
    for (_, settings) in solo_settings() {
        for (id, v) in settings {
            let v = if matches!(id, FX_DIST_ENABLED | FX_CHORUS_ENABLED | FX_DELAY_ENABLED | FX_REVERB_ENABLED | FX_OTT_ENABLED | FX_EQ_ENABLED) { 0.0 } else { v };
            ev.push((0, Event::Param(id, v)));
        }
    }
    ev.extend(synth_events());
    ev.sort_by_key(|e| e.0);
    let (l, r) = render_offline(SR, &ev, 48000);
    assert_eq!(l, dl);
    assert_eq!(r, dr);
}

#[test]
fn switching_an_effect_off_returns_to_dry() {
    for (name, settings) in solo_settings() {
        let mut c = chain_with(&settings);
        let x = sine(220.0, 0.5, 48000);
        run(&mut c, &x, &x);
        let enable = settings.last().unwrap().0;
        c.set_param(enable, 0.0);
        let (l, _) = run(&mut c, &x[..4800], &x[..4800]);
        // The bypass fade is 10 ms; after it the output is the input, exactly.
        assert_eq!(&l[1024..], &x[1024..4800], "{name}");
    }
}

#[test]
fn delay_echo_lands_on_the_beat_division() {
    // 120 bpm, 1/8 = 0.25 s = 12000 samples at 48 kHz.
    let mut c = chain_with(&[(FX_DELAY_TIME, 1.0), (FX_DELAY_FEEDBACK, 0.0), (FX_DELAY_MIX, 1.0), (FX_DELAY_PING_PONG, 0.0), (FX_DELAY_ENABLED, 1.0)]);
    c.set_bpm(120.0);
    let t0 = 1024;
    let mut x = vec![0.0f32; 30000];
    x[t0] = 1.0;
    let (l, r) = run(&mut c, &x, &x);
    let argmax = |v: &[f32]| v.iter().enumerate().max_by(|a, b| a.1.abs().total_cmp(&b.1.abs())).unwrap().0;
    assert_eq!(argmax(&l) - t0, 12000);
    assert_eq!(argmax(&r) - t0, 12000);
    assert!((l[t0 + 12000] - 1.0).abs() < 1e-6);
    // Mix 1 removes the dry impulse.
    assert!(l[t0].abs() < 1e-6);
}

#[test]
fn delay_follows_bpm() {
    let mut c = chain_with(&[(FX_DELAY_TIME, 0.0), (FX_DELAY_ENABLED, 1.0)]);
    c.set_bpm(120.0);
    assert_eq!(c.delay.fx.time_samples(), 24000.0);
    c.set_bpm(150.0);
    assert_eq!(c.delay.fx.time_samples(), 19200.0);
    // A tempo change mid-echo glides rather than jumping: no sample-to-sample step
    // larger than a 220 Hz sine can produce on its own.
    let x = sine(220.0, 0.5, 48000);
    let mut c = chain_with(&[(FX_DELAY_TIME, 1.0), (FX_DELAY_FEEDBACK, 0.5), (FX_DELAY_MIX, 1.0), (FX_DELAY_ENABLED, 1.0)]);
    c.set_bpm(120.0);
    let (a, _) = run(&mut c, &x, &x);
    c.set_bpm(90.0);
    let (b, _) = run(&mut c, &x, &x);
    let max_step = |v: &[f32]| v.windows(2).map(|w| (w[1] - w[0]).abs()).fold(0.0f32, f32::max);
    let limit = 2.0 * PI * 220.0 / SR * 0.5 * 4.0; // generous: 4x the dry sine's max slope
    assert!(max_step(&a) < limit && max_step(&b) < limit, "{} {}", max_step(&a), max_step(&b));
}

#[test]
fn ping_pong_alternates_channels() {
    let mut c = chain_with(&[(FX_DELAY_TIME, 1.0), (FX_DELAY_FEEDBACK, 0.6), (FX_DELAY_MIX, 1.0), (FX_DELAY_PING_PONG, 1.0), (FX_DELAY_ENABLED, 1.0)]);
    c.set_bpm(120.0);
    let t0 = 1024;
    let mut x = vec![0.0f32; 40000];
    x[t0] = 1.0;
    let (l, r) = run(&mut c, &x, &x);
    let around = |v: &[f32], t: usize| v[t - 64..t + 64].iter().map(|s| s * s).sum::<f32>();
    let (e1l, e1r) = (around(&l, t0 + 12000), around(&r, t0 + 12000));
    let (e2l, e2r) = (around(&l, t0 + 24000), around(&r, t0 + 24000));
    assert!(e1l > 0.1 && e1r < 1e-9, "first echo L {e1l} R {e1r}");
    assert!(e2r > 0.01 && e2l < 1e-9, "second echo L {e2l} R {e2r}");
}

#[test]
fn reverb_tail_outlives_the_note() {
    let note = |reverb: bool| {
        let mut ev = vec![
            (0, Event::Param(ENV1_RELEASE, 0.01)),
            (0, Event::Param(FX_REVERB_DECAY, 0.7)),
            (0, Event::Param(FX_REVERB_MIX, 0.5)),
            (0, Event::Param(FX_REVERB_ENABLED, if reverb { 1.0 } else { 0.0 })),
            (0, Event::NoteOn(60, 1.0)),
            (4800, Event::NoteOff(60)),
        ];
        ev.sort_by_key(|e| e.0);
        render_offline(SR, &ev, 48000)
    };
    let (dry, _) = note(false);
    let (wet_l, wet_r) = note(true);
    assert!(dry[9600..].iter().all(|&v| v == 0.0));
    assert!(rms(&wet_l[9600..19200]) > 1e-3, "tail {}", rms(&wet_l[9600..19200]));
    // Stereo: the two sides are decorrelated.
    assert!(wet_l[9600..19200] != wet_r[9600..19200]);
}

#[test]
fn distortion_adds_harmonics_with_sane_level() {
    let f0 = 375.0; // 128-sample period: exact bins
    let x = sine(f0, 0.5, 48000);
    assert!(thd(&x[9600..], f0) < 1e-3);
    for kind in 0..5 {
        for drive in [0.0, 0.7, 1.0] {
            let mut c = chain_with(&[(FX_DIST_TYPE, kind as f32), (FX_DIST_DRIVE, drive), (FX_DIST_MIX, 1.0), (FX_DIST_ENABLED, 1.0)]);
            let (l, r) = run(&mut c, &x, &x);
            let tail = &l[9600..];
            assert!(l.iter().chain(r.iter()).all(|v| v.is_finite()));
            let db = 20.0 * (rms(tail) / rms(&x[9600..])).log10();
            assert!(db.abs() < 6.0, "type {kind} drive {drive}: level {db:.1} dB");
            if drive >= 0.7 {
                assert!(thd(tail, f0) > 0.1, "type {kind} drive {drive}: thd {}", thd(tail, f0));
            }
        }
    }
}

#[test]
fn eq_low_boost_raises_lows_only() {
    let lo = sine(80.0, 0.1, 48000);
    let hi = sine(12000.0, 0.1, 48000);
    let mut c = chain_with(&[(FX_EQ_LOW, 12.0), (FX_EQ_ENABLED, 1.0)]);
    let (l, _) = run(&mut c, &lo, &lo);
    let gain_lo = rms(&l[9600..]) / rms(&lo[9600..]);
    let mut c = chain_with(&[(FX_EQ_LOW, 12.0), (FX_EQ_ENABLED, 1.0)]);
    let (h, _) = run(&mut c, &hi, &hi);
    let gain_hi = rms(&h[9600..]) / rms(&hi[9600..]);
    assert!(gain_lo > 3.0, "low gain {gain_lo}");
    assert!((gain_hi - 1.0).abs() < 0.05, "high gain {gain_hi}");
}

#[test]
fn ott_lifts_quiet_and_tames_loud() {
    let gain = |amp: f32| {
        let x = sine(1000.0, amp, 48000);
        let mut c = chain_with(&[(FX_OTT_DEPTH, 1.0), (FX_OTT_ENABLED, 1.0)]);
        let (l, _) = run(&mut c, &x, &x);
        assert!(l.iter().all(|v| v.is_finite()));
        rms(&l[24000..]) / rms(&x[24000..])
    };
    assert!(gain(0.003) > 2.0, "quiet gain {}", gain(0.003));
    assert!(gain(0.9) < 0.5, "loud gain {}", gain(0.9));
    // Digital silence stays silent.
    let mut c = chain_with(&[(FX_OTT_DEPTH, 1.0), (FX_OTT_ENABLED, 1.0)]);
    let z = vec![0.0f32; 4800];
    let (l, _) = run(&mut c, &z, &z);
    assert!(l.iter().all(|&v| v == 0.0));
}

#[test]
fn chorus_widens_a_mono_input() {
    let x = sine(440.0, 0.5, 48000);
    let mut c = chain_with(&[(FX_CHORUS_DEPTH, 0.6), (FX_CHORUS_MIX, 0.5), (FX_CHORUS_ENABLED, 1.0)]);
    let (l, r) = run(&mut c, &x, &x);
    let side: Vec<f32> = l.iter().zip(&r).map(|(a, b)| a - b).collect();
    assert!(rms(&side[9600..]) > 0.02, "side {}", rms(&side[9600..]));
}

#[test]
fn stress_everything_on_at_max() {
    let mut ev: Vec<(usize, Event)> = vec![
        (0, Event::Param(FILTER_RESONANCE, 1.0)),
        (0, Event::Param(OSC_A_TABLE, 4.0)),
        (0, Event::Param(ENV1_SUSTAIN, 1.0)),
    ];
    for (_, settings) in solo_settings() {
        ev.extend(settings.into_iter().map(|(id, v)| (0, Event::Param(id, v))));
    }
    ev.extend(synth_events());
    for k in 0..100 {
        let t = 200 + k * 960;
        ev.push((t, Event::Param(FILTER_CUTOFF, 20.0 * 1000f32.powf((k % 17) as f32 / 16.0))));
        ev.push((t, Event::Param(FX_DIST_TYPE, (k % 5) as f32)));
        ev.push((t, Event::Param(FX_REVERB_SIZE, (k % 7) as f32 / 6.0)));
        ev.push((t, Event::Transport(true, 60.0 + (k % 9) as f32 * 20.0)));
    }
    ev.sort_by_key(|e| e.0);
    let (l, r) = render_offline(SR, &ev, 48000 * 3);
    for x in l.iter().chain(r.iter()) {
        assert!(x.is_finite() && x.abs() <= 1.0);
    }
    assert!(rms(&l[120000..]) > 1e-3, "tail");

    // Chain alone, pre-clipper, on full-scale noise.
    let mut c = FxChain::new(SR);
    for (_, settings) in solo_settings() {
        for (id, v) in settings {
            c.set_param(id, v);
        }
    }
    let mut seed = 1u32;
    let noise: Vec<f32> = (0..48000 * 3)
        .map(|_| {
            seed ^= seed << 13;
            seed ^= seed >> 17;
            seed ^= seed << 5;
            seed as f32 / u32::MAX as f32 * 2.0 - 1.0
        })
        .collect();
    let (l, r) = run(&mut c, &noise, &noise);
    assert!(l.iter().chain(r.iter()).all(|x| x.is_finite()));
    assert!(peak(&l).max(peak(&r)) < 16.0, "peak {}", peak(&l).max(peak(&r)));
}


#[test]
fn enabling_before_setting_params_starts_from_the_new_params() {
    // The patch sync sends `enabled` (lower id) before the effect's other params.
    let mut c = FxChain::new(SR);
    c.set_bpm(120.0);
    for (id, v) in [(FX_DELAY_ENABLED, 1.0), (FX_DELAY_TIME, 1.0), (FX_DELAY_FEEDBACK, 0.0), (FX_DELAY_MIX, 1.0), (FX_DELAY_PING_PONG, 0.0)] {
        c.set_param(id, v);
    }
    // Impulse just after the 10 ms bypass fade; a mix gliding up from 0.25 would leak dry here.
    let t0 = 600;
    let mut x = vec![0.0f32; 14000];
    x[t0] = 1.0;
    let (l, _) = run(&mut c, &x, &x);
    assert!(l[t0].abs() < 1e-6, "mix glided from its old value: {}", l[t0]);
    assert!((l[t0 + 12000] - 1.0).abs() < 1e-6, "time glided from its old value");
}

#[test]
#[ignore]
fn print_levels() {
    let x: Vec<f32> = (0..96000).map(|i| 0.3 * (((i as f32 * 220.0 / SR) % 1.0) * 2.0 - 1.0)).collect();
    for (name, s) in solo_settings() {
        let mut c = chain_with(&s);
        let (l, r) = run(&mut c, &x, &x);
        println!("{name:<10} full: L {:+.1} dB R {:+.1} dB peak {:.2}", 20.0 * (rms(&l[48000..]) / rms(&x)).log10(), 20.0 * (rms(&r[48000..]) / rms(&x)).log10(), peak(&l));
    }
    for (name, s) in [
        ("reverb def", vec![(FX_REVERB_ENABLED, 1.0), (FX_REVERB_MIX, 1.0)]),
        ("ott def", vec![(FX_OTT_ENABLED, 1.0)]),
        ("delay def", vec![(FX_DELAY_ENABLED, 1.0), (FX_DELAY_MIX, 1.0)]),
    ] {
        let mut c = chain_with(&s);
        let (l, _) = run(&mut c, &x, &x);
        println!("{name:<10} wet: {:+.1} dB", 20.0 * (rms(&l[48000..]) / rms(&x)).log10());
    }
}
