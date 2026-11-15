use osc8_engine::engine::{render_offline, Engine, Event};
use osc8_engine::instrument::Instrument;
use osc8_engine::modulation::src;
use osc8_engine::params::*;
use osc8_engine::synth::WavetableSynth;

const SR: f32 = 48000.0;
const BASE_CUTOFF: f32 = 1000.0;

fn lfo(i: u32, field: u32) -> u32 {
    LFO_BASE + i * LFO_STRIDE + field
}
fn slot(s: u32, field: u32) -> u32 {
    MOD_BASE + s * MOD_STRIDE + field
}
fn env2(field: u32) -> u32 {
    ENV_BASE + field
}

/// (id, value) pairs for one route.
fn route(s: u32, source: usize, target: u32, amount: f32, aux: usize) -> Vec<(u32, f32)> {
    vec![
        (slot(s, MOD_SOURCE), source as f32),
        (slot(s, MOD_TARGET), target as f32),
        (slot(s, MOD_AMOUNT), amount),
        (slot(s, MOD_AUX), aux as f32),
    ]
}

fn free_lfo(i: u32, shape: f32, hz: f32) -> Vec<(u32, f32)> {
    vec![(lfo(i, LFO_SHAPE), shape), (lfo(i, LFO_SYNC), 0.0), (lfo(i, LFO_RATE), hz), (lfo(i, LFO_ONE_SHOT), 0.0)]
}

/// env2 as a constant 1 (instant attack, sustain 1).
fn env2_constant() -> Vec<(u32, f32)> {
    vec![(env2(0), 0.0), (env2(1), 0.0), (env2(2), 1.0), (env2(3), 0.0)]
}

fn synth(params: &[(u32, f32)]) -> WavetableSynth {
    let mut s = WavetableSynth::new(SR);
    s.set_param(FILTER_CUTOFF, BASE_CUTOFF);
    s.set_param(ENV1_SUSTAIN, 1.0);
    for &(id, v) in params {
        s.set_param(id, v);
    }
    s
}

fn run(s: &mut WavetableSynth, samples: usize) {
    let mut l = [0.0f32; 128];
    let mut r = [0.0f32; 128];
    let mut done = 0;
    while done < samples {
        let n = (samples - done).min(128);
        s.render(&mut l[..n], &mut r[..n]);
        done += n;
    }
}

fn cutoff_of(s: &WavetableSynth, note: u8) -> f32 {
    s.voice_cutoffs().find(|&(n, _)| n == note).map(|(_, c)| c).expect("voice sounding")
}

/// Cutoff of `note` sampled every `step` samples for `total` samples.
fn trace(s: &mut WavetableSynth, note: u8, step: usize, total: usize) -> Vec<f32> {
    (0..total / step)
        .map(|_| {
            run(s, step);
            cutoff_of(s, note)
        })
        .collect()
}

/// Indices of local maxima.
fn peaks(x: &[f32]) -> Vec<usize> {
    (1..x.len() - 1).filter(|&i| x[i] > x[i - 1] && x[i] >= x[i + 1]).collect()
}

fn rms(x: &[f32]) -> f32 {
    (x.iter().map(|v| v * v).sum::<f32>() / x.len() as f32).sqrt()
}

fn brightness(x: &[f32]) -> f32 {
    x.windows(2).map(|w| (w[1] - w[0]).powi(2)).sum::<f32>() / x.iter().map(|v| v * v).sum::<f32>().max(1e-12)
}

#[test]
fn free_lfo_on_cutoff_has_the_right_period() {
    let mut p = free_lfo(0, 0.0, 1.0);
    p.extend(route(0, src::LFO1, FILTER_CUTOFF, 0.3, src::NONE));
    let mut s = synth(&p);
    s.note_on(48, 1.0);
    let t = trace(&mut s, 48, 240, 48000 * 3); // 5 ms resolution
    let pk = peaks(&t);
    assert!(pk.len() >= 3, "{pk:?}");
    for w in pk.windows(2) {
        let period_s = (w[1] - w[0]) as f32 * 240.0 / SR;
        assert!((period_s - 1.0).abs() < 0.011, "period {period_s}");
    }
    // Sine starting at phase 0: first peak a quarter cycle in.
    assert!((pk[0] as f32 * 240.0 / SR - 0.25).abs() < 0.011);

    // And it is audible: the filtered saw is brighter at the LFO peak than at the trough.
    let mut ev: Vec<(usize, Event)> = vec![(0, Event::Param(FILTER_CUTOFF, BASE_CUTOFF)), (0, Event::Param(OSC_A_POSITION, 0.67))];
    ev.extend(p.iter().map(|&(id, v)| (0, Event::Param(id, v))));
    ev.push((0, Event::NoteOn(48, 1.0)));
    let (l, _) = render_offline(SR, &ev, 48000 * 2);
    let win = |t: f32| brightness(&l[(t * SR) as usize - 1200..(t * SR) as usize + 1200]);
    assert!(win(0.25) > win(0.75) * 3.0, "peak {} trough {}", win(0.25), win(0.75));
    assert!((win(1.25) / win(0.25) - 1.0).abs() < 0.15, "{} vs {}", win(1.25), win(0.25));
}

#[test]
fn synced_quarter_note_lfo_is_half_a_second_at_120() {
    let mut p = vec![(lfo(0, LFO_SHAPE), 0.0), (lfo(0, LFO_SYNC), 1.0), (lfo(0, LFO_DIVISION), 2.0)];
    p.extend(route(0, src::LFO1, FILTER_CUTOFF, 0.3, src::NONE));
    let mut s = synth(&p);
    s.set_bpm(120.0);
    s.note_on(48, 1.0);
    let t = trace(&mut s, 48, 240, 48000 * 2);
    let pk = peaks(&t);
    for w in pk.windows(2) {
        let period_s = (w[1] - w[0]) as f32 * 240.0 / SR;
        assert!((period_s - 0.5).abs() < 0.011, "period {period_s}");
    }
    assert!(pk.len() >= 3);
}

#[test]
fn lfos_retrigger_per_voice() {
    let mut p = free_lfo(0, 0.0, 1.0);
    p.extend(route(0, src::LFO1, FILTER_CUTOFF, 0.3, src::NONE));
    let mut s = synth(&p);
    s.note_on(48, 1.0);
    run(&mut s, 14400); // 0.3 s
    s.note_on(55, 1.0);
    // Note 55 lags note 48 by exactly 0.3 s of LFO phase.
    let mut a = Vec::new();
    let mut b = Vec::new();
    for _ in 0..200 {
        run(&mut s, 240);
        a.push(cutoff_of(&s, 48));
        b.push(cutoff_of(&s, 55));
    }
    let lag = 14400 / 240;
    for i in 0..(200 - lag) {
        assert!((b[i + lag] / a[i] - 1.0).abs() < 0.01, "i {i}: {} vs {}", b[i + lag], a[i]);
    }
    assert!((a[10] / b[10] - 1.0).abs() > 0.05, "phases should differ");
}

#[test]
fn one_shot_lfo_holds_its_end_value() {
    // Rising saw, one shot at 2 Hz: sweeps for 0.5 s then holds +1.
    let mut p = free_lfo(0, 2.0, 2.0);
    p.push((lfo(0, LFO_ONE_SHOT), 1.0));
    p.extend(route(0, src::LFO1, FILTER_CUTOFF, 0.2, src::NONE));
    let mut s = synth(&p);
    s.note_on(48, 1.0);
    run(&mut s, 2400);
    let early = cutoff_of(&s, 48);
    let t = trace(&mut s, 48, 480, 48000 * 2);
    let held = BASE_CUTOFF * 1000f32.powf(0.2);
    assert!(early < BASE_CUTOFF, "saw starts at -1: {early}");
    for c in &t[60..] {
        assert!((c / held - 1.0).abs() < 1e-3, "{c} vs {held}");
    }
}

#[test]
fn env2_sweeps_cutoff_per_note() {
    let mut p = vec![(env2(0), 0.05), (env2(1), 0.1), (env2(2), 0.0), (env2(3), 0.1)];
    p.extend(route(0, src::ENV2, FILTER_CUTOFF, 0.3, src::NONE));
    let mut s = synth(&p);
    s.note_on(48, 1.0);
    run(&mut s, 2400); // 50 ms: top of the attack
    let a_peak = cutoff_of(&s, 48);
    run(&mut s, 21600); // 0.5 s: decayed
    let a_rest = cutoff_of(&s, 48);
    s.note_on(55, 1.0);
    run(&mut s, 2400);
    let b_peak = cutoff_of(&s, 55);
    let a_now = cutoff_of(&s, 48);
    let top = BASE_CUTOFF * 1000f32.powf(0.3);
    assert!(a_peak > top * 0.9, "{a_peak}");
    assert!((a_rest / BASE_CUTOFF - 1.0).abs() < 0.02, "{a_rest}");
    assert!(b_peak > top * 0.9, "{b_peak}");
    assert!((a_now / BASE_CUTOFF - 1.0).abs() < 0.02, "note 48 must not be retriggered: {a_now}");
}

fn render_with(params: &[(u32, f32)], frames: usize) -> (Vec<f32>, Vec<f32>) {
    let mut ev: Vec<(usize, Event)> = vec![(0, Event::Param(OSC_A_POSITION, 0.67))];
    ev.extend(params.iter().map(|&(id, v)| (0, Event::Param(id, v))));
    ev.push((0, Event::NoteOn(48, 1.0)));
    ev.push((0, Event::NoteOn(60, 0.7)));
    render_offline(SR, &ev, frames)
}

#[test]
fn amount_zero_is_identical_to_no_route() {
    let base = render_with(&free_lfo(0, 0.0, 5.0), 24000);
    let mut p = free_lfo(0, 0.0, 5.0);
    p.extend(route(0, src::LFO1, FILTER_CUTOFF, 0.0, src::NONE));
    p.extend(route(1, src::RANDOM, FX_REVERB_MIX, 0.0, src::VELOCITY));
    assert_eq!(render_with(&p, 24000), base);
    // A route with no target is also inert.
    let mut p = free_lfo(0, 0.0, 5.0);
    p.extend(route(0, src::LFO1, FILTER_CUTOFF, 1.0, src::NONE));
    p.push((slot(0, MOD_TARGET), -1.0));
    assert_eq!(render_with(&p, 24000), base);
}

#[test]
fn aux_scales_and_routes_sum() {
    let mut p = env2_constant();
    p.extend(route(0, src::ENV2, FILTER_CUTOFF, 0.4, src::VELOCITY));
    let mut s = synth(&p);
    s.note_on(48, 0.5);
    run(&mut s, 4800);
    let expect = BASE_CUTOFF * 1000f32.powf(0.4 * 0.5);
    assert!((cutoff_of(&s, 48) / expect - 1.0).abs() < 1e-3, "{} vs {expect}", cutoff_of(&s, 48));

    // Two routes on one target sum: 0.1 + 0.15 == 0.25.
    let mut p = env2_constant();
    p.extend(route(0, src::ENV2, FILTER_CUTOFF, 0.1, src::NONE));
    p.extend(route(1, src::ENV2, FILTER_CUTOFF, 0.15, src::NONE));
    let mut s = synth(&p);
    s.note_on(48, 1.0);
    run(&mut s, 4800);
    let expect = BASE_CUTOFF * 1000f32.powf(0.25);
    assert!((cutoff_of(&s, 48) / expect - 1.0).abs() < 1e-3);
}

#[test]
fn log_cutoff_modulation_is_symmetric_in_octaves_and_clamped() {
    let at = |amount: f32| {
        let mut p = env2_constant();
        p.extend(route(0, src::ENV2, FILTER_CUTOFF, amount, src::NONE));
        let mut s = synth(&p);
        s.note_on(48, 1.0);
        run(&mut s, 4800);
        cutoff_of(&s, 48)
    };
    let (up, down) = (at(0.1), at(-0.1));
    assert!(((up / BASE_CUTOFF).log2() + (down / BASE_CUTOFF).log2()).abs() < 1e-3, "{up} {down}");
    assert!(((up / BASE_CUTOFF).log2() - 0.1 * 1000f32.log2()).abs() < 1e-3);
    // Clamped to the range (and below Nyquist).
    assert!((at(1.0) - 20000.0).abs() < 1.0, "{}", at(1.0));
    assert!((at(-1.0) - 20.0).abs() < 0.01, "{}", at(-1.0));
}

#[test]
fn readback_and_global_fx_targets() {
    let mut e = Engine::new(SR);
    assert_eq!(osc8_engine::modulation::TARGET_SLOTS, 170);
    e.set_param(OSC_A_POSITION, 0.8);
    e.set_param(FX_REVERB_ENABLED, 1.0);
    e.set_param(FX_REVERB_MIX, 0.5);
    e.process(128);
    assert!(!e.mod_active());
    assert_eq!(e.mod_values[OSC_A_POSITION as usize], 0.8);

    for (id, v) in free_lfo(0, 0.0, 2.0).into_iter().chain(route(0, src::LFO1, FX_REVERB_MIX, 0.4, src::NONE)) {
        e.set_param(id, v);
    }
    for (id, v) in env2_constant().into_iter().chain(route(1, src::ENV2, OSC_A_POSITION, 1.0, src::NONE)) {
        e.set_param(id, v);
    }
    assert!(e.mod_active());
    e.note_on(60, 1.0);
    let mut mix = Vec::new();
    for _ in 0..375 {
        e.process(128); // 1 s
        mix.push(e.mod_values[FX_REVERB_MIX as usize]);
    }
    let (lo, hi) = mix.iter().fold((f32::MAX, f32::MIN), |(a, b), &v| (a.min(v), b.max(v)));
    assert!(lo < 0.15 && hi > 0.85, "reverb mix range {lo}..{hi}");
    assert!(mix.iter().all(|v| (0.0..=1.0).contains(v)));
    // Position: 0.8 + 1.0 * env2 -> clamped at the top of its range.
    assert_eq!(e.mod_values[OSC_A_POSITION as usize], 1.0);
    // Untargeted params read back their knob value.
    assert_eq!(e.mod_values[FILTER_CUTOFF as usize], 4000.0);
}

#[test]
fn fx_targets_are_modulated_even_without_a_sounding_voice() {
    // Global LFOs keep running after the note ends (the "most recent note" context).
    let mut e = Engine::new(SR);
    for (id, v) in free_lfo(0, 0.0, 4.0).into_iter().chain(route(0, src::LFO1, FX_DELAY_MIX, 0.5, src::NONE)) {
        e.set_param(id, v);
    }
    e.note_on(60, 1.0);
    e.note_off(60);
    let mut vals = Vec::new();
    for _ in 0..200 {
        e.process(128);
        vals.push(e.mod_values[FX_DELAY_MIX as usize]);
    }
    let spread = vals.iter().cloned().fold(f32::MIN, f32::max) - vals.iter().cloned().fold(f32::MAX, f32::min);
    assert!(spread > 0.5, "{spread}");
}

#[test]
fn master_volume_is_post_fx() {
    let tail = |kill_volume: bool| {
        let mut ev = vec![
            (0, Event::Param(ENV1_RELEASE, 0.01)),
            (0, Event::Param(FX_REVERB_DECAY, 0.9)),
            (0, Event::Param(FX_REVERB_MIX, 0.5)),
            (0, Event::Param(FX_REVERB_ENABLED, 1.0)),
            (0, Event::NoteOn(60, 1.0)),
            (4800, Event::NoteOff(60)),
        ];
        if kill_volume {
            ev.push((9600, Event::Param(MASTER_VOLUME, 0.0)));
        }
        render_offline(SR, &ev, 48000).0
    };
    let on = tail(false);
    let off = tail(true);
    assert!(rms(&on[14400..24000]) > 1e-3, "tail present with volume up");
    // The reverb tail is inside the volume: it stops (exactly) once volume reaches 0.
    assert!(off[14400..].iter().all(|&v| v == 0.0), "rms {}", rms(&off[14400..]));
}

#[test]
fn stress_sixteen_routes_at_audio_rate_lfos() {
    let targets = [
        OSC_A_POSITION, OSC_A_LEVEL, OSC_A_SEMI, OSC_A_FINE, FILTER_CUTOFF, FILTER_RESONANCE, MASTER_VOLUME,
        FX_DIST_DRIVE, FX_DIST_MIX, FX_CHORUS_MIX, FX_DELAY_MIX, FX_DELAY_FEEDBACK, FX_REVERB_MIX, FX_REVERB_SIZE,
        FX_OTT_DEPTH, FX_EQ_LOW,
    ];
    let mut p: Vec<(u32, f32)> = Vec::new();
    for i in 0..4 {
        p.extend(free_lfo(i, i as f32 + if i == 3 { 1.0 } else { 0.0 }, 50.0 - i as f32 * 7.0)); // sine, tri, saw, random
    }
    for (s, &t) in targets.iter().enumerate() {
        let source = [src::LFO1, src::LFO1 + 1, src::LFO1 + 2, src::LFO1 + 3, src::ENV1, src::RANDOM][s % 6];
        let amount = if s % 2 == 0 { 1.0 } else { -0.7 };
        p.extend(route(s as u32, source, t, amount, if s % 3 == 0 { src::LFO1 + 1 } else { src::NONE }));
    }
    for id in [FX_DIST_ENABLED, FX_CHORUS_ENABLED, FX_DELAY_ENABLED, FX_REVERB_ENABLED, FX_OTT_ENABLED, FX_EQ_ENABLED] {
        p.push((id, 1.0));
    }
    p.push((FILTER_RESONANCE, 0.9));
    let mut ev: Vec<(usize, Event)> = p.iter().map(|&(id, v)| (0, Event::Param(id, v))).collect();
    for (i, n) in [36u8, 43, 48, 55, 60, 64, 67, 72].iter().enumerate() {
        ev.push((i * 100, Event::NoteOn(*n, 1.0)));
    }
    let (l, r) = render_offline(SR, &ev, 48000 * 2);
    for x in l.iter().chain(r.iter()) {
        assert!(x.is_finite() && x.abs() <= 1.0);
    }
    assert!(rms(&l) > 0.01);

    // Smoothness: the same patch on a sine (no position route, no FX) has no
    // zipper steps: the largest sample-to-sample jump stays near what the
    // sine itself produces.
    let mut p: Vec<(u32, f32)> = Vec::new();
    for i in 0..4 {
        p.extend(free_lfo(i, [0.0, 1.0, 3.0, 4.0][i as usize], 50.0));
    }
    let smooth_targets = [OSC_A_LEVEL, OSC_A_FINE, FILTER_CUTOFF, FILTER_RESONANCE, MASTER_VOLUME, OSC_A_SEMI];
    for (s, &t) in smooth_targets.iter().enumerate() {
        p.extend(route(s as u32, src::LFO1 + s % 4, t, if t == OSC_A_SEMI { 0.02 } else { 0.5 }, src::NONE));
    }
    p.push((FILTER_ENABLED, 0.0));
    p.push((ENV1_ATTACK, 0.05));
    let mut ev: Vec<(usize, Event)> = p.iter().map(|&(id, v)| (0, Event::Param(id, v))).collect();
    ev.push((0, Event::NoteOn(57, 1.0)));
    let (l, _) = render_offline(SR, &ev, 48000);
    let max_step = l[4800..].windows(2).map(|w| (w[1] - w[0]).abs()).fold(0.0f32, f32::max);
    // A 220 Hz sine at this level moves at most ~0.011/sample; a square LFO on
    // level without ramping would jump by ~0.3 in one sample.
    assert!(max_step < 0.03, "max step {max_step}");
}
