//! Native render-time benchmark: `cargo run --release --example bench --manifest-path engine/Cargo.toml`
//! 8 held voices on the saw frame, 128-frame blocks at 48 kHz: FX off / each FX / all FX, and 16 mod routes.
use osc8_engine::engine::Engine;
use osc8_engine::params::*;
use std::time::Instant;

const SR: f32 = 48000.0;
const BLOCKS: usize = 20_000; // ~53 s of audio

fn bench(label: &str, fx: &[(u32, f32)]) -> f64 {
    bench_with(label, fx, false)
}

/// `drums`: every one of the 11 drum voices hit on every 16th at 140 bpm.
fn bench_with(label: &str, fx: &[(u32, f32)], drums: bool) -> f64 {
    let mut e = Engine::new(SR);
    if drums {
        e.drums.pattern_clear(16);
        for s in 0..16 {
            for v in 0..osc8_engine::drums::DRUM_VOICES as u32 {
                e.drums.pattern_add(s, v, 1.0, s % 4 == 0);
            }
        }
        for v in 0..osc8_engine::drums::DRUM_VOICES as u32 {
            e.set_param(1000 + v * 8 + 2, 1.0); // longest decays
        }
        e.set_transport(true, 140.0);
    }
    e.set_param(OSC_A_POSITION, 0.67);
    e.set_param(ENV1_SUSTAIN, 1.0);
    for &(id, v) in fx {
        e.set_param(id, v);
    }
    for n in [36u8, 43, 48, 55, 60, 64, 67, 72] {
        e.note_on(n, 0.8);
    }
    for _ in 0..500 {
        e.process(128);
    }
    let t = Instant::now();
    let mut acc = 0.0f32;
    for _ in 0..BLOCKS {
        e.process(128);
        acc += e.out_left[0];
    }
    let us = t.elapsed().as_secs_f64() * 1e6 / BLOCKS as f64;
    let budget = 128.0 / SR as f64 * 1e6;
    println!("{label:<12} {us:7.2} us/block  ({:5.1}% of the {budget:.0} us real-time budget){}", 100.0 * us / budget, if acc.is_nan() { " NaN!" } else { "" });
    us
}

fn main() {
    let dist = [(FX_DIST_ENABLED, 1.0), (FX_DIST_DRIVE, 0.6)];
    let chorus = [(FX_CHORUS_ENABLED, 1.0)];
    let delay = [(FX_DELAY_ENABLED, 1.0), (FX_DELAY_FEEDBACK, 0.6)];
    let reverb = [(FX_REVERB_ENABLED, 1.0)];
    let ott = [(FX_OTT_ENABLED, 1.0), (FX_OTT_DEPTH, 1.0)];
    let eq = [(FX_EQ_ENABLED, 1.0), (FX_EQ_LOW, 3.0)];
    bench("fx off", &[]);
    bench("distortion", &dist);
    bench("chorus", &chorus);
    bench("delay", &delay);
    bench("reverb", &reverb);
    bench("ott", &ott);
    bench("eq", &eq);
    let all: Vec<_> = [&dist[..], &chorus, &delay, &reverb, &ott, &eq].concat();
    bench("all fx on", &all);

    // 16 live mod routes from fast LFOs/envs onto voice and global targets.
    let targets = [
        OSC_A_POSITION, OSC_A_LEVEL, OSC_A_SEMI, OSC_A_FINE, FILTER_CUTOFF, FILTER_RESONANCE, MASTER_VOLUME,
        FX_DIST_DRIVE, FX_DIST_MIX, FX_CHORUS_MIX, FX_DELAY_MIX, FX_DELAY_FEEDBACK, FX_REVERB_MIX, FX_REVERB_SIZE,
        FX_OTT_DEPTH, FX_EQ_LOW,
    ];
    let mut routes = Vec::new();
    for i in 0..4u32 {
        let b = LFO_BASE + i * LFO_STRIDE;
        routes.extend([(b + LFO_SHAPE, i as f32), (b + LFO_SYNC, 0.0), (b + LFO_RATE, 20.0 + 10.0 * i as f32)]);
    }
    for (s, &t) in targets.iter().enumerate() {
        let b = MOD_BASE + s as u32 * MOD_STRIDE;
        let source = [4.0, 5.0, 6.0, 7.0, 2.0][s % 5];
        routes.extend([(b + MOD_SOURCE, source), (b + MOD_TARGET, t as f32), (b + MOD_AMOUNT, 0.3), (b + MOD_AUX, if s % 2 == 0 { 8.0 } else { 0.0 })]);
    }
    bench("16 routes", &routes);
    let all_mod: Vec<_> = [&all[..], &routes].concat();
    bench("16 routes+fx", &all_mod);

    // Worst case: both oscs at 16 unison, sub, noise, all FX, 16 routes.
    let big = [
        (OSC_A_UNISON, 16.0), (OSC_A_DETUNE, 0.4), (OSC_A_SPREAD, 1.0),
        (OSC_B_ENABLED, 1.0), (OSC_B_UNISON, 16.0), (OSC_B_DETUNE, 0.3), (OSC_B_SPREAD, 1.0), (OSC_B_POSITION, 0.4),
        (SUB_ENABLED, 1.0), (NOISE_ENABLED, 1.0),
    ];
    bench("A 16 unison", &big[..3]);
    bench("A+B 16 uni", &big[..8]);
    let worst: Vec<_> = [&all_mod[..], &big].concat();
    bench("WORST CASE", &worst);
    bench_with("808 only", &[], true);
    bench_with("WORST + 808", &worst, true);
}
