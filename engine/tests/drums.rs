//! The 808 drum track (param IDs 1000+).
#![allow(clippy::needless_range_loop)]
use osc8_engine::drums::*;
use osc8_engine::engine::Engine;
use osc8_engine::params::*;

const SR: f32 = 48000.0;
const NAMES: [&str; 11] = ["kick", "snare", "clap", "rim", "closedHat", "openHat", "lowTom", "midTom", "highTom", "cowbell", "cymbal"];

fn id(voice: usize, field: u32) -> u32 {
    DRUM_PARAM_BASE + voice as u32 * DRUM_VOICE_STRIDE + field
}

fn run(e: &mut Engine, frames: usize) -> (Vec<f32>, Vec<f32>) {
    let (mut l, mut r) = (Vec::with_capacity(frames), Vec::with_capacity(frames));
    let mut done = 0;
    while done < frames {
        let n = (frames - done).min(128);
        e.process(n);
        l.extend_from_slice(&e.out_left[..n]);
        r.extend_from_slice(&e.out_right[..n]);
        done += n;
    }
    (l, r)
}

fn rms(x: &[f32]) -> f32 {
    (x.iter().map(|v| (*v as f64).powi(2)).sum::<f64>() / x.len().max(1) as f64).sqrt() as f32
}
fn peak(x: &[f32]) -> f32 {
    x.iter().fold(0.0f32, |m, v| m.max(v.abs()))
}
fn pitch(x: &[f32]) -> f32 {
    let ups: Vec<f32> = (1..x.len()).filter(|&i| x[i - 1] < 0.0 && x[i] >= 0.0).map(|i| (i - 1) as f32 + x[i - 1] / (x[i - 1] - x[i])).collect();
    (ups.len() - 1) as f32 / (ups[ups.len() - 1] - ups[0]) * SR
}
/// Time (s) after the peak at which the 10 ms-windowed RMS has fallen by `db`.
fn fall_time(x: &[f32], db: f32) -> f32 {
    let w = 480;
    let env: Vec<f32> = x.chunks(w).map(rms).collect();
    let (pk_i, pk) = env.iter().enumerate().fold((0, 0.0f32), |a, (i, &v)| if v > a.1 { (i, v) } else { a });
    let target = pk * 10f32.powf(-db / 20.0);
    let i = env.iter().enumerate().skip(pk_i).find(|(_, &v)| v < target).map(|(i, _)| i).unwrap_or(env.len());
    (i - pk_i) as f32 * w as f32 / SR
}

#[test]
fn param_ids_match_drums_ts() {
    assert_eq!(id(0, F_LEVEL), 1000);
    assert_eq!(id(10, F_MUTE), 1086);
    assert_eq!((BUS_ACCENT, BUS_LEVEL, BUS_DRIVE, BUS_SWING), (1100, 1101, 1102, 1103));
    let mut e = Engine::new(SR);
    e.set_param(id(KICK, F_TUNE), 1.0);
    assert_eq!(e.drums.kit[KICK].tune, 1.0);
    e.set_param(BUS_SWING, 0.5);
    assert_eq!(e.drums.swing, 0.5);
}

#[test]
fn every_voice_sounds_is_bounded_and_ends() {
    for v in 0..DRUM_VOICES {
        let mut e = Engine::new(SR);
        e.drum_trigger(v, 1.0);
        let (l, r) = run(&mut e, 48000 * 4);
        assert!(l.iter().chain(&r).all(|x| x.is_finite() && x.abs() <= 1.0), "{}", NAMES[v]);
        assert!(rms(&l[..4800]) > 0.01, "{} rms {}", NAMES[v], rms(&l[..4800]));
        assert!(!e.drums.sounding(v), "{} never ends", NAMES[v]);
        assert!(l[48000 * 3..].iter().all(|&x| x == 0.0), "{} tail", NAMES[v]);
    }
}

#[test]
fn kick_settles_on_its_tuned_fundamental() {
    let kick = |tune: f32| {
        let mut e = Engine::new(SR);
        e.set_param(id(KICK, F_TUNE), tune);
        e.set_param(id(KICK, F_DECAY), 1.0);
        e.drum_trigger(KICK, 1.0);
        let (l, _) = run(&mut e, 48000);
        pitch(&l[7200..36000])
    };
    let f0 = |tune: f32| 45.0 * (65.0f32 / 45.0).powf(tune);
    for tune in [0.0, 0.5, 1.0] {
        let p = kick(tune);
        assert!((p / f0(tune) - 1.0).abs() < 0.03, "tune {tune}: {p} Hz vs {}", f0(tune));
    }
    // The attack starts well above it (the 808 pitch drop).
    let mut e = Engine::new(SR);
    e.drum_trigger(KICK, 1.0);
    let (l, _) = run(&mut e, 2400);
    assert!(pitch(&l[..960]) > 1.5 * f0(0.5), "{}", pitch(&l[..960]));
}

#[test]
fn kick_decay_tracks_the_decay_knob() {
    let len = |decay: f32| {
        let mut e = Engine::new(SR);
        e.set_param(id(KICK, F_DECAY), decay);
        e.drum_trigger(KICK, 1.0);
        fall_time(&run(&mut e, 48000 * 4).0, 40.0)
    };
    let (short, mid, long) = (len(0.1), len(0.5), len(0.9));
    assert!(short < mid && mid < long, "{short} {mid} {long}");
    // -40 dB is 2/3 of the T60 (0.2 * 12.5^decay s); allow for the saturation.
    let t60 = |d: f32| 0.2 * 12.5f32.powf(d);
    for (d, t) in [(0.1, short), (0.5, mid), (0.9, long)] {
        assert!((t / (t60(d) * 2.0 / 3.0) - 1.0).abs() < 0.3, "decay {d}: {t} s vs T60 {}", t60(d));
    }
}

#[test]
fn closed_hat_chokes_the_open_hat() {
    let tail = |choke: bool| {
        let mut e = Engine::new(SR);
        e.set_param(id(OPEN_HAT, F_DECAY), 1.0);
        e.drum_trigger(OPEN_HAT, 1.0);
        run(&mut e, 2400);
        if choke {
            e.drum_trigger(CLOSED_HAT, 1.0);
        }
        let (l, _) = run(&mut e, 48000);
        (rms(&l[9600..19200]), e.drums.sounding(OPEN_HAT))
    };
    let (ringing, _) = tail(false);
    let (choked, open_sounding) = tail(true);
    assert!(ringing > 0.005, "{ringing}");
    assert!(choked < ringing * 0.01, "{choked} vs {ringing}");
    assert!(!open_sounding);
}

/// Every step has a closed hat; returns the trigger sample positions.
fn hat_positions(bpm: f32, swing: f32, ticks: usize) -> (Vec<u64>, f64) {
    let mut e = Engine::new(SR);
    e.drums.log = Some(Vec::with_capacity(64));
    e.set_param(BUS_SWING, swing);
    e.drums.pattern_clear(16);
    for s in 0..16 {
        e.drums.pattern_add(s, CLOSED_HAT as u32, 0.8, false);
    }
    e.set_transport(true, bpm);
    let spp = e.sequencer.samples_per_step();
    let frames = (spp * ticks as f64) as usize;
    let mut done = 0;
    while done < frames {
        let n = (frames - done).min(if done % 2 == 0 { 128 } else { 77 });
        e.process(n);
        done += n;
    }
    (e.drums.log.take().unwrap().into_iter().map(|(t, _)| t).collect(), spp)
}

#[test]
fn pattern_plays_on_exact_samples() {
    for bpm in [120.0, 130.0, 97.0] {
        let (pos, spp) = hat_positions(bpm, 0.0, 20);
        let expect: Vec<u64> = (0..pos.len() as u64).map(|k| (k as f64 * spp).ceil() as u64).collect();
        assert_eq!(pos, expect, "bpm {bpm}");
        assert!(pos.len() >= 19);
    }
}

#[test]
fn swing_delays_odd_steps_only() {
    let (pos, spp) = hat_positions(120.0, 0.6, 16);
    let delay = (0.6 * spp / 3.0).round() as u64; // 1200 samples at 120 bpm
    assert_eq!(delay, 1200);
    for (k, &p) in pos.iter().enumerate() {
        let grid = (k as f64 * spp).ceil() as u64;
        let want = if k % 2 == 1 { grid + delay } else { grid };
        assert_eq!(p, want, "tick {k}");
    }
}

#[test]
fn accent_is_louder_and_mute_silences() {
    let hit = |accent: bool, mute: bool| {
        let mut e = Engine::new(SR);
        e.set_param(id(SNARE, F_MUTE), if mute { 1.0 } else { 0.0 });
        e.drums.trigger(SNARE, 0.8, accent);
        peak(&run(&mut e, 9600).0)
    };
    let (plain, accented) = (hit(false, false), hit(true, false));
    assert!(accented > plain * 1.2, "{accented} vs {plain}");
    assert_eq!(hit(false, true), 0.0);
    // Velocity scales too.
    let mut e = Engine::new(SR);
    e.drums.trigger(SNARE, 0.3, false);
    assert!(peak(&run(&mut e, 9600).0) < plain * 0.6);
}

#[test]
fn drums_bypass_the_patch_fx_and_master_volume() {
    let rim = |fx: bool, volume: f32| {
        let mut e = Engine::new(SR);
        if fx {
            for (i, v) in [(FX_REVERB_ENABLED, 1.0), (FX_REVERB_MIX, 1.0), (FX_REVERB_DECAY, 1.0), (FX_DELAY_ENABLED, 1.0), (FX_DELAY_MIX, 1.0), (FX_DIST_ENABLED, 1.0)] {
                e.set_param(i, v);
            }
        }
        e.set_param(MASTER_VOLUME, volume);
        run(&mut e, 4800); // let the FX fade in
        e.drum_trigger(RIM, 1.0);
        run(&mut e, 48000).0
    };
    let dry = rim(false, 0.7);
    assert_eq!(rim(true, 0.7), dry, "synth FX must not process drums");
    assert_eq!(rim(false, 0.0), dry, "master volume is the synth's");
    assert!(dry[24000..].iter().all(|&x| x == 0.0), "no reverb tail on a rim shot");
}

#[test]
fn stress_all_voices_at_once_with_a_busy_synth() {
    let mut e = Engine::new(SR);
    for (i, v) in [
        (OSC_A_UNISON, 16.0), (OSC_B_ENABLED, 1.0), (OSC_B_UNISON, 16.0), (SUB_ENABLED, 1.0), (NOISE_ENABLED, 1.0),
        (FX_REVERB_ENABLED, 1.0), (FX_DIST_ENABLED, 1.0), (BUS_DRIVE, 1.0), (BUS_LEVEL, 1.0), (BUS_ACCENT, 1.0),
    ] {
        e.set_param(i, v);
    }
    for v in 0..DRUM_VOICES {
        e.set_param(id(v, F_LEVEL), 1.0);
        e.set_param(id(v, F_DECAY), 1.0);
    }
    for n in [36, 43, 48, 55, 60, 64, 67, 72] {
        e.note_on(n, 1.0);
    }
    e.drums.pattern_clear(16);
    for s in 0..16 {
        for v in 0..DRUM_VOICES as u32 {
            e.drums.pattern_add(s, v, 1.0, s % 4 == 0);
        }
    }
    e.set_transport(true, 140.0);
    let (l, r) = run(&mut e, 48000 * 2);
    assert!(l.iter().chain(&r).all(|x| x.is_finite() && x.abs() <= 1.0));
    assert!(rms(&l) > 0.05);
}

#[test]
#[ignore]
fn print_voice_levels() {
    for v in 0..DRUM_VOICES {
        let mut e = Engine::new(SR);
        e.set_param(id(v, F_LEVEL), 1.0);
        e.set_param(BUS_DRIVE, 0.0);
        e.set_param(BUS_LEVEL, 1.0);
        e.drum_trigger(v, 1.0);
        let (l, r) = run(&mut e, 48000 * 3);
        println!("{:<10} peak {:.3} rms100ms {:.4} len-40dB {:.3}s", NAMES[v], peak(&l).max(peak(&r)), rms(&l[..4800]), fall_time(&l, 40.0));
    }
}
