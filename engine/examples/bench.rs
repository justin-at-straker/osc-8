//! Native render-time benchmark: `cargo run --release --example bench --manifest-path engine/Cargo.toml`
//! 8 held voices on the saw frame, 128-frame blocks at 48 kHz, FX off vs each FX vs all FX on.
use osc8_engine::engine::Engine;
use osc8_engine::params::*;
use std::time::Instant;

const SR: f32 = 48000.0;
const BLOCKS: usize = 20_000; // ~53 s of audio

fn bench(label: &str, fx: &[(u32, f32)]) -> f64 {
    let mut e = Engine::new(SR);
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
}
