//! 2x quality mode for the synth track.
//!
//! [`Oversampled`] owns two [`WavetableSynth`]s sharing one set of wavetables:
//! one at the host rate and one at twice it. Whichever the QUALITY param
//! selects plays; the 2x one renders double-length blocks and is decimated
//! through the halfband shared with the distortion. Running the voices at 2x
//! halves the aliasing from everything nonlinear or modulated inside them
//! (filter drive, audio-rate filter changes, mip crossfades), the way Vital
//! (2x by default), Surge (2x voice path) and Serum 2 (1x/2x/4x) do.
//!
//! Every param goes to both synths so switching keeps the sound; notes go only
//! to the one playing, and switching silences it (its voices would otherwise
//! freeze mid-envelope while it isn't rendered).

use crate::dsp::{halfband, Oversampler, HALFBAND_TAPS};
use crate::engine::MAX_BLOCK;
use crate::instrument::Instrument;
use crate::modulation::GlobalMod;
use crate::params::QUALITY;
use crate::synth::WavetableSynth;

pub struct Oversampled {
    base: WavetableSynth,
    high: WavetableSynth,
    two_x: bool,
    h: [f32; HALFBAND_TAPS],
    down: [Oversampler; 2],
    hl: Vec<f32>,
    hr: Vec<f32>,
}

impl Oversampled {
    pub fn new(sample_rate: f32) -> Self {
        let base = WavetableSynth::new(sample_rate);
        let high = WavetableSynth::with_tables(2.0 * sample_rate, base.tables());
        Self {
            base,
            high,
            two_x: false,
            h: halfband(),
            down: [Oversampler::new(); 2],
            hl: vec![0.0; 2 * MAX_BLOCK],
            hr: vec![0.0; 2 * MAX_BLOCK],
        }
    }

    /// True when the 2x synth is playing.
    pub fn two_x(&self) -> bool {
        self.two_x
    }

    fn active(&mut self) -> &mut WavetableSynth {
        if self.two_x { &mut self.high } else { &mut self.base }
    }

    fn set_quality(&mut self, two_x: bool) {
        if two_x == self.two_x {
            return;
        }
        self.active().kill_voices();
        self.two_x = two_x;
        self.down = [Oversampler::new(); 2];
    }
}

impl Instrument for Oversampled {
    fn note_on(&mut self, note: u8, velocity: f32) {
        self.active().note_on(note, velocity);
    }

    fn note_off(&mut self, note: u8) {
        self.active().note_off(note);
    }

    fn all_notes_off(&mut self) {
        self.active().all_notes_off();
    }

    fn set_param(&mut self, id: u32, value: f32) {
        if id == QUALITY {
            if value.is_finite() {
                self.set_quality(value >= 0.5);
            }
            return;
        }
        self.base.set_param(id, value);
        self.high.set_param(id, value);
    }

    fn render(&mut self, left: &mut [f32], right: &mut [f32]) {
        if !self.two_x {
            self.base.render(left, right);
            return;
        }
        let n = left.len().min(right.len());
        let mut pos = 0;
        while pos < n {
            let m = (n - pos).min(MAX_BLOCK);
            let (hl, hr) = (&mut self.hl[..2 * m], &mut self.hr[..2 * m]);
            self.high.render(hl, hr);
            for i in 0..m {
                left[pos + i] = self.down[0].down(&self.h, hl[2 * i], hl[2 * i + 1]);
                right[pos + i] = self.down[1].down(&self.h, hr[2 * i], hr[2 * i + 1]);
            }
            pos += m;
        }
    }

    fn set_bpm(&mut self, bpm: f32) {
        self.base.set_bpm(bpm);
        self.high.set_bpm(bpm);
    }

    fn set_modwheel(&mut self, value: f32) {
        self.base.set_modwheel(value);
        self.high.set_modwheel(value);
    }

    fn global_mod(&self) -> Option<&GlobalMod> {
        if self.two_x { self.high.global_mod() } else { self.base.global_mod() }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::params::*;

    const SR: f32 = 48000.0;

    fn render(s: &mut Oversampled, n: usize) -> Vec<f32> {
        let (mut l, mut r) = (vec![0.0; n], vec![0.0; n]);
        for (lc, rc) in l.chunks_mut(128).zip(r.chunks_mut(128)) {
            s.render(lc, rc);
        }
        l
    }

    /// Magnitude of `freq` in `x` (Goertzel, Hann-windowed).
    fn tone(x: &[f32], freq: f32) -> f32 {
        let w = 2.0 * core::f32::consts::PI * freq / SR;
        let c = 2.0 * w.cos();
        let n = x.len() as f32;
        let (mut s1, mut s2) = (0.0f32, 0.0f32);
        for (i, &v) in x.iter().enumerate() {
            let win = 0.5 - 0.5 * (2.0 * core::f32::consts::PI * i as f32 / n).cos();
            let s = v * win + c * s1 - s2;
            s2 = s1;
            s1 = s;
        }
        (s1 * s1 + s2 * s2 - c * s1 * s2).sqrt()
    }

    #[test]
    fn two_x_plays_in_tune_and_switching_is_clean() {
        let mut s = Oversampled::new(SR);
        s.set_param(QUALITY, 1.0);
        assert!(s.two_x());
        s.set_param(FILTER_ENABLED, 0.0);
        s.note_on(69, 1.0);
        let l = render(&mut s, 24000);
        let tail = &l[4800..];
        assert!(tone(tail, 440.0) > 50.0 * tone(tail, 466.0), "plays A440");
        // Switching back silences the 2x voices; the 1x synth starts empty.
        s.set_param(QUALITY, 0.0);
        let l = render(&mut s, 4800);
        assert!(l.iter().all(|&v| v == 0.0));
        s.note_on(60, 1.0);
        let l = render(&mut s, 4800);
        assert!(l.iter().all(|v| v.is_finite()) && l.iter().any(|&v| v != 0.0));
    }

    #[test]
    fn two_x_cuts_drive_aliasing() {
        // A ~4978 Hz sine through full filter drive: its 7th harmonic (34.8 kHz)
        // folds to ~13.2 kHz at 1x; at 2x it stays above Nyquist and the
        // halfband removes it.
        let alias = |q: f32| {
            let mut s = Oversampled::new(SR);
            s.set_param(QUALITY, q);
            s.set_param(OSC_A_POSITION, 0.0);
            s.set_param(FILTER_CUTOFF, 20000.0);
            s.set_param(FILTER_DRIVE, 1.0);
            s.note_on(111, 1.0);
            let l = render(&mut s, 24000);
            let f0 = 440.0 * 2f32.powf((111.0 - 69.0) / 12.0);
            let tail = &l[4800..];
            tone(tail, SR - 7.0 * f0) / tone(tail, f0)
        };
        let (one, two) = (alias(0.0), alias(1.0));
        assert!(two < one * 0.5, "1x alias {one}, 2x alias {two}");
    }
}
