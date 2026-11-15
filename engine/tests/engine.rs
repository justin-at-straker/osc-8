use osc8_engine::engine::{render_offline, Engine, Event, MAX_BLOCK};
use osc8_engine::instrument::Instrument;
use osc8_engine::params::*;
use std::cell::RefCell;
use std::rc::Rc;

const SR: f32 = 48000.0;

fn rms(x: &[f32]) -> f32 {
    (x.iter().map(|v| v * v).sum::<f32>() / x.len() as f32).sqrt()
}

/// Energy of the first difference: a crude high-frequency measure.
fn diff_energy(x: &[f32]) -> f32 {
    x.windows(2).map(|w| (w[1] - w[0]).powi(2)).sum::<f32>()
}

fn peak(x: &[f32]) -> f32 {
    x.iter().fold(0.0f32, |m, v| m.max(v.abs()))
}

/// The default patch, as patchToParams(defaultPatch()) sends it.
fn default_params() -> Vec<(usize, Event)> {
    [
        (OSC_A_TABLE, 0.0),
        (OSC_A_POSITION, 0.0),
        (OSC_A_LEVEL, 0.75),
        (OSC_A_OCTAVE, 0.0),
        (OSC_A_SEMI, 0.0),
        (OSC_A_FINE, 0.0),
        (FILTER_CUTOFF, 4000.0),
        (FILTER_RESONANCE, 0.2),
        (FILTER_ENABLED, 1.0),
        (ENV1_ATTACK, 0.005),
        (ENV1_DECAY, 0.3),
        (ENV1_SUSTAIN, 0.7),
        (ENV1_RELEASE, 0.25),
        (MASTER_VOLUME, 0.7),
    ]
    .iter()
    .map(|&(id, v)| (0, Event::Param(id, v)))
    .collect()
}

#[test]
fn param_ids_match_params_ts() {
    // Mirrors src/engine/params.ts. Append only.
    let ids = [
        OSC_A_TABLE, OSC_A_POSITION, OSC_A_LEVEL, OSC_A_OCTAVE, OSC_A_SEMI, OSC_A_FINE,
        FILTER_CUTOFF, FILTER_RESONANCE, FILTER_ENABLED, ENV1_ATTACK, ENV1_DECAY, ENV1_SUSTAIN,
        ENV1_RELEASE, MASTER_VOLUME,
        FX_DIST_ENABLED, FX_DIST_TYPE, FX_DIST_DRIVE, FX_DIST_MIX,
        FX_CHORUS_ENABLED, FX_CHORUS_RATE, FX_CHORUS_DEPTH, FX_CHORUS_MIX,
        FX_DELAY_ENABLED, FX_DELAY_TIME, FX_DELAY_FEEDBACK, FX_DELAY_MIX, FX_DELAY_PING_PONG,
        FX_REVERB_ENABLED, FX_REVERB_SIZE, FX_REVERB_DECAY, FX_REVERB_DAMPING, FX_REVERB_MIX,
        FX_OTT_ENABLED, FX_OTT_DEPTH, FX_OTT_TIME,
        FX_EQ_ENABLED, FX_EQ_LOW, FX_EQ_MID, FX_EQ_HIGH,
    ];
    for (i, id) in ids.iter().enumerate() {
        assert_eq!(*id as usize, i);
    }
    assert_eq!(BASE_PARAM_COUNT as usize, ids.len());
    assert_eq!(MOD_END, 131);
    assert_eq!(PARAM_COUNT, 173);
    assert_eq!(QUALITY, 172);
    assert_eq!((OSC_A_DETUNE_CURVE, OSC_B_DETUNE_CURVE), (170, 171));
    assert_eq!((FILTER_DRIVE, FILTER_KEYTRACK, VOICE_DRIFT), (167, 168, 169));
    assert_eq!((VOICE_MODE, VOICE_LEGATO, GLIDE_TIME), (164, 165, 166));
}

#[test]
fn silent_when_nothing_plays() {
    let (l, r) = render_offline(SR, &default_params(), 48000);
    assert!(l.iter().chain(r.iter()).all(|&v| v == 0.0));
}

#[test]
fn non_silent_after_note_on() {
    let mut ev = default_params();
    ev.push((0, Event::NoteOn(60, 1.0)));
    let (l, r) = render_offline(SR, &ev, 9600);
    assert!(rms(&l[480..]) > 0.05, "rms {}", rms(&l[480..]));
    assert_eq!(l, r);
    assert!(l.iter().all(|v| v.is_finite()));
}

#[test]
fn every_table_sounds_across_positions() {
    for table in 0..5 {
        for pos in [0.0, 0.5, 1.0] {
            let mut ev = default_params();
            ev.push((0, Event::Param(OSC_A_TABLE, table as f32)));
            ev.push((0, Event::Param(OSC_A_POSITION, pos)));
            ev.push((0, Event::Param(FILTER_ENABLED, 0.0)));
            ev.push((0, Event::NoteOn(57, 1.0)));
            let (l, _) = render_offline(SR, &ev, 9600);
            let tail = &l[4800..];
            assert!(rms(tail) > 0.02, "table {table} pos {pos} rms {}", rms(tail));
            assert!(tail.iter().all(|v| v.is_finite()));
        }
    }
}

fn brightness(cutoff: f32, enabled: bool) -> f32 {
    let mut ev = default_params();
    ev.push((0, Event::Param(OSC_A_POSITION, 0.67))); // saw
    ev.push((0, Event::Param(FILTER_RESONANCE, 0.0)));
    ev.push((0, Event::Param(FILTER_CUTOFF, cutoff)));
    ev.push((0, Event::Param(FILTER_ENABLED, if enabled { 1.0 } else { 0.0 })));
    ev.push((0, Event::NoteOn(48, 1.0)));
    let (l, _) = render_offline(SR, &ev, 24000);
    diff_energy(&l[4800..])
}

#[test]
fn lowering_cutoff_reduces_high_frequencies() {
    let open = brightness(12000.0, true);
    let mid = brightness(2000.0, true);
    let closed = brightness(300.0, true);
    assert!(mid < open * 0.8, "open {open} mid {mid}");
    assert!(closed < mid * 0.3, "mid {mid} closed {closed}");
    // Bypass ignores the cutoff entirely.
    let bypass = brightness(300.0, false);
    assert!(bypass > closed * 5.0, "bypass {bypass} closed {closed}");
}

#[test]
fn master_volume_zero_is_silent() {
    let mut ev = default_params();
    ev.push((0, Event::Param(MASTER_VOLUME, 0.0)));
    ev.push((0, Event::NoteOn(60, 1.0)));
    let (l, _) = render_offline(SR, &ev, 9600);
    // The volume smoother starts at the previous value (0.7) and settles within a few ms.
    assert!(l[4800..].iter().all(|&v| v == 0.0), "peak {}", peak(&l[4800..]));
}

#[test]
fn note_off_releases_to_silence() {
    let mut ev = default_params();
    ev.push((0, Event::Param(ENV1_RELEASE, 0.05)));
    ev.push((0, Event::NoteOn(60, 1.0)));
    ev.push((4800, Event::NoteOff(60)));
    let (l, _) = render_offline(SR, &ev, 48000);
    assert!(rms(&l[2400..4800]) > 0.05);
    assert!(l[24000..].iter().all(|&v| v == 0.0));
}

#[test]
fn stress_eight_voices_max_resonance_stays_bounded() {
    let mut ev = default_params();
    ev.push((0, Event::Param(OSC_A_TABLE, 4.0)));
    ev.push((0, Event::Param(OSC_A_LEVEL, 1.0)));
    ev.push((0, Event::Param(MASTER_VOLUME, 1.0)));
    ev.push((0, Event::Param(FILTER_RESONANCE, 1.0)));
    ev.push((0, Event::Param(ENV1_ATTACK, 0.0)));
    ev.push((0, Event::Param(ENV1_SUSTAIN, 1.0)));
    for (i, n) in [24u8, 36, 43, 48, 55, 60, 67, 72, 84, 96, 108, 127].iter().enumerate() {
        ev.push((i * 7, Event::NoteOn(*n, 1.0)));
    }
    // Sweep cutoff and position hard while everything is held.
    for k in 0..200 {
        let f = 20.0 * (1000.0f32).powf((k % 50) as f32 / 49.0);
        ev.push((100 + k * 480, Event::Param(FILTER_CUTOFF, f)));
        ev.push((100 + k * 480, Event::Param(OSC_A_POSITION, (k % 13) as f32 / 12.0)));
    }
    ev.sort_by_key(|e| e.0);
    let (l, r) = render_offline(SR, &ev, 48000 * 2);
    for x in l.iter().chain(r.iter()) {
        assert!(x.is_finite());
        assert!(x.abs() <= 1.0);
    }
    assert!(rms(&l) > 0.01);
}

#[test]
fn transport_reports_current_step() {
    let mut e = Engine::new(SR);
    assert_eq!(osc8_engine::current_step(), -1); // no global engine yet
    assert_eq!(e.sequencer.current_step(), -1);
    e.set_transport(true, 120.0);
    e.process(MAX_BLOCK);
    assert_eq!(e.sequencer.current_step(), 0);
    // 120 bpm @ 48k = 6000 samples per step.
    for _ in 0..(6000 / MAX_BLOCK) {
        e.process(MAX_BLOCK);
    }
    assert_eq!(e.sequencer.current_step(), 1);
    e.set_transport(false, 120.0);
    assert_eq!(e.sequencer.current_step(), -1);
}

/// Records note events with the sample index at which they happened.
#[derive(Default)]
struct Log {
    pos: usize,
    events: Vec<(usize, &'static str, u8)>,
}

struct Recorder(Rc<RefCell<Log>>);

impl Instrument for Recorder {
    fn note_on(&mut self, note: u8, _velocity: f32) {
        let mut l = self.0.borrow_mut();
        let p = l.pos;
        l.events.push((p, "on", note));
    }
    fn note_off(&mut self, note: u8) {
        let mut l = self.0.borrow_mut();
        let p = l.pos;
        l.events.push((p, "off", note));
    }
    fn all_notes_off(&mut self) {
        let mut l = self.0.borrow_mut();
        let p = l.pos;
        l.events.push((p, "all-off", 0));
    }
    fn set_param(&mut self, _id: u32, _value: f32) {}
    fn render(&mut self, left: &mut [f32], right: &mut [f32]) {
        left.fill(0.0);
        right.fill(0.0);
        self.0.borrow_mut().pos += left.len();
    }
}

#[test]
fn sequencer_fires_on_exact_samples() {
    for &(sr, bpm) in &[(48000.0f32, 120.0f32), (48000.0, 130.0), (44100.0, 97.0)] {
        let log = Rc::new(RefCell::new(Log::default()));
        let mut e = Engine::with_instrument(sr, Box::new(Recorder(log.clone())));
        e.sequencer.pattern_clear(16);
        e.sequencer.pattern_add(0, 60, 2, 1.0);
        e.sequencer.pattern_add(4, 64, 1, 0.8);
        e.sequencer.pattern_add(15, 67, 3, 0.5); // wraps past the loop
        e.set_transport(true, bpm);
        let spp = sr as f64 * 60.0 / bpm as f64 / 4.0;
        let total_steps = 34;
        let frames = (spp * total_steps as f64) as usize;
        let mut done = 0;
        while done < frames {
            // Odd block sizes to prove boundaries don't depend on the block grid.
            let n = (frames - done).min(if done % 2 == 0 { 128 } else { 77 });
            e.process(n);
            done += n;
        }
        let at = |k: u32| (k as f64 * spp).ceil() as usize;
        let mut expected = Vec::new();
        for k in 0..total_steps {
            let step = k % 16;
            // Offs before ons at each boundary.
            if k >= 2 && (k - 2) % 16 == 0 {
                expected.push((at(k), "off", 60));
            }
            if k >= 1 && (k - 1) % 16 == 4 {
                expected.push((at(k), "off", 64));
            }
            if k >= 3 && (k - 3) % 16 == 15 {
                expected.push((at(k), "off", 67));
            }
            match step {
                0 => expected.push((at(k), "on", 60)),
                4 => expected.push((at(k), "on", 64)),
                15 => expected.push((at(k), "on", 67)),
                _ => {}
            }
        }
        let mut got: Vec<_> = log.borrow().events.iter().filter(|e| e.0 < frames).cloned().collect();
        // Events are in time order, and at a shared sample every "off" precedes every "on".
        assert!(got.windows(2).all(|w| (w[0].0, w[0].1) <= (w[1].0, w[1].1)), "{got:?}");
        got.sort();
        expected.sort();
        assert_eq!(got, expected, "sr {sr} bpm {bpm}");
    }
}

#[test]
fn stop_releases_everything() {
    let mut ev = default_params();
    ev.push((0, Event::Param(ENV1_RELEASE, 0.05)));
    ev.push((0, Event::Pattern { steps: 16 }));
    ev.push((0, Event::PatternNote { step: 0, note: 48, length: 16, velocity: 1.0 }));
    ev.push((0, Event::Transport(true, 120.0)));
    ev.push((0, Event::NoteOn(72, 1.0))); // a live note alongside the sequencer
    ev.push((12000, Event::Transport(false, 120.0)));
    let (l, _) = render_offline(SR, &ev, 48000);
    assert!(rms(&l[6000..12000]) > 0.05);
    assert!(l[36000..].iter().all(|&v| v == 0.0));
}

#[test]
fn master_clipper_is_linear_below_the_knee_and_bounded() {
    use osc8_engine::engine::{soft_clip, CLIP_KNEE};
    for i in -100..=100 {
        let x = i as f32 / 100.0 * CLIP_KNEE;
        assert_eq!(soft_clip(x), x);
    }
    let mut last = soft_clip(CLIP_KNEE);
    for i in 1..1000 {
        let y = soft_clip(CLIP_KNEE + i as f32 * 0.01);
        assert!(y >= last && y <= 1.0, "monotonic and bounded");
        last = y;
    }
    assert_eq!(soft_clip(-3.0), -soft_clip(3.0));
    assert_eq!(soft_clip(f32::NAN), 0.0);
}
