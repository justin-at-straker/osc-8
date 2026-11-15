//! Band-limited wavetables.
//!
//! Each table holds `FRAMES` frames of `TABLE_SIZE` samples. Every frame is
//! defined as a harmonic spectrum and rendered once per mip level (one level
//! per octave), keeping only the harmonics that fit under Nyquist for the
//! notes that level serves. Playback picks the mip level from the note's
//! frequency and linearly interpolates within and between frames.

#![allow(clippy::needless_range_loop)] // loops index by harmonic number

use core::f32::consts::PI;

pub const TABLE_SIZE: usize = 2048;
pub const MAX_HARMONICS: usize = TABLE_SIZE / 2;
/// Mip levels: level `k` keeps harmonics `1..=MAX_HARMONICS >> k`.
pub const MIP_LEVELS: usize = 11;
pub const FRAMES: usize = 16;
/// One guard sample per frame so interpolation never wraps.
const STRIDE: usize = TABLE_SIZE + 1;

pub const BUILTIN_NAMES: [&str; 5] = ["basic", "pwm", "harmonic-sweep", "formant", "digital"];

pub struct Wavetable {
    /// `[level][frame][STRIDE]`
    data: Vec<f32>,
    pub frames: usize,
}

impl Wavetable {
    /// Build a table from per-frame spectra. `spectrum(t, &mut re, &mut im)` fills harmonic
    /// coefficients for frame position `t` in 0..=1, where harmonic `h` contributes
    /// `re[h] * cos(2 pi h x) + im[h] * sin(2 pi h x)`. Index 0 (DC) is ignored.
    pub fn from_spectra(frames: usize, mut spectrum: impl FnMut(f32, &mut [f32], &mut [f32])) -> Self {
        let mut data = vec![0.0f32; MIP_LEVELS * frames * STRIDE];
        let mut re = vec![0.0f32; MAX_HARMONICS + 1];
        let mut im = vec![0.0f32; MAX_HARMONICS + 1];
        let mut buf_re = vec![0.0f32; TABLE_SIZE];
        let mut buf_im = vec![0.0f32; TABLE_SIZE];
        for f in 0..frames {
            let t = if frames > 1 { f as f32 / (frames - 1) as f32 } else { 0.0 };
            re.iter_mut().for_each(|v| *v = 0.0);
            im.iter_mut().for_each(|v| *v = 0.0);
            spectrum(t, &mut re, &mut im);
            let mut gain = 1.0f32;
            for level in 0..MIP_LEVELS {
                let max_h = MAX_HARMONICS >> level;
                synth_frame(&re, &im, max_h, &mut buf_re, &mut buf_im);
                if level == 0 {
                    // Normalize every level by the full-band peak so loudness is
                    // consistent across the keyboard.
                    let peak = buf_re.iter().fold(0.0f32, |m, v| m.max(v.abs()));
                    gain = if peak > 1e-9 { 1.0 / peak } else { 0.0 };
                }
                let base = (level * frames + f) * STRIDE;
                for i in 0..TABLE_SIZE {
                    data[base + i] = buf_re[i] * gain;
                }
                data[base + TABLE_SIZE] = data[base];
            }
        }
        Self { data, frames }
    }

    /// Mip level for a fundamental of `freq_hz` at `sample_rate`.
    #[inline]
    pub fn level_for(freq_hz: f32, sample_rate: f32) -> usize {
        let max_h = (sample_rate * 0.5 / freq_hz.max(1.0)) as usize;
        let mut level = 0;
        while level < MIP_LEVELS - 1 && (MAX_HARMONICS >> level) > max_h {
            level += 1;
        }
        level
    }

    /// Sample at `phase` in 0..1, morph `position` in 0..1, at mip `level`.
    #[inline]
    pub fn sample(&self, level: usize, position: f32, phase: f32) -> f32 {
        let fpos = position.clamp(0.0, 1.0) * (self.frames - 1) as f32;
        let f0 = (fpos as usize).min(self.frames - 1);
        let f1 = (f0 + 1).min(self.frames - 1);
        let ff = fpos - f0 as f32;
        let p = phase * TABLE_SIZE as f32;
        let i = (p as usize).min(TABLE_SIZE - 1);
        let fr = p - i as f32;
        let b0 = (level * self.frames + f0) * STRIDE + i;
        let b1 = (level * self.frames + f1) * STRIDE + i;
        let a = self.data[b0] + (self.data[b0 + 1] - self.data[b0]) * fr;
        let b = self.data[b1] + (self.data[b1 + 1] - self.data[b1]) * fr;
        a + (b - a) * ff
    }

    /// Raw frame access for tests and visualisation.
    pub fn frame(&self, level: usize, frame: usize) -> &[f32] {
        let base = (level * self.frames + frame) * STRIDE;
        &self.data[base..base + TABLE_SIZE]
    }
}

/// Inverse transform a harmonic spectrum (up to `max_h`) into one period.
fn synth_frame(re: &[f32], im: &[f32], max_h: usize, out_re: &mut [f32], out_im: &mut [f32]) {
    // x[n] = sum_h a_h cos + b_h sin  ==  Re( sum_h (a_h - i b_h) e^{i 2 pi h n / N} )
    out_re.iter_mut().for_each(|v| *v = 0.0);
    out_im.iter_mut().for_each(|v| *v = 0.0);
    // Inverse DFT via forward FFT of the conjugate: conj(a - i b) = a + i b.
    // The result is conjugated too, but only the real part is used.
    let top = max_h.min(MAX_HARMONICS - 1);
    out_re[1..=top].copy_from_slice(&re[1..=top]);
    out_im[1..=top].copy_from_slice(&im[1..=top]);
    fft(out_re, out_im);
}

/// In-place iterative radix-2 complex FFT (forward, unnormalized).
pub fn fft(re: &mut [f32], im: &mut [f32]) {
    let n = re.len();
    debug_assert!(n.is_power_of_two() && im.len() == n);
    let bits = n.trailing_zeros();
    for i in 0..n {
        let j = i.reverse_bits() >> (usize::BITS - bits);
        if j > i {
            re.swap(i, j);
            im.swap(i, j);
        }
    }
    let mut len = 2;
    while len <= n {
        let ang = -2.0 * core::f64::consts::PI / len as f64;
        let half = len / 2;
        for start in (0..n).step_by(len) {
            for k in 0..half {
                let (s, c) = (ang * k as f64).sin_cos();
                let (wr, wi) = (c as f32, s as f32);
                let a = start + k;
                let b = a + half;
                let tr = re[b] * wr - im[b] * wi;
                let ti = re[b] * wi + im[b] * wr;
                re[b] = re[a] - tr;
                im[b] = im[a] - ti;
                re[a] += tr;
                im[a] += ti;
            }
        }
        len <<= 1;
    }
}

/// Fill a spectrum from one period of a time-domain waveform (TABLE_SIZE samples).
fn spectrum_from_wave(wave: &[f32], re: &mut [f32], im: &mut [f32]) {
    let mut wr: Vec<f32> = wave.to_vec();
    let mut wi = vec![0.0f32; TABLE_SIZE];
    fft(&mut wr, &mut wi);
    let scale = 2.0 / TABLE_SIZE as f32;
    for h in 1..MAX_HARMONICS {
        // X[h] = sum x e^{-i..}; x = sum (Re X cos - Im X sin) * 2/N
        re[h] = wr[h] * scale;
        im[h] = -wi[h] * scale;
    }
}

fn lerp(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}

/// Sine (im) amplitudes for the classic shapes.
fn shape_sine(h: usize) -> f32 {
    if h == 1 { 1.0 } else { 0.0 }
}
fn shape_triangle(h: usize) -> f32 {
    if h % 2 == 1 {
        let sign = if (h / 2) % 2 == 0 { 1.0 } else { -1.0 };
        sign * 8.0 / (PI * PI * (h * h) as f32)
    } else {
        0.0
    }
}
fn shape_saw(h: usize) -> f32 {
    let sign = if h % 2 == 1 { 1.0 } else { -1.0 };
    sign * 2.0 / (PI * h as f32)
}
fn shape_square(h: usize) -> f32 {
    if h % 2 == 1 { 4.0 / (PI * h as f32) } else { 0.0 }
}

fn basic(t: f32, _re: &mut [f32], im: &mut [f32]) {
    // sine -> triangle -> saw -> square across three equal segments.
    let shapes: [fn(usize) -> f32; 4] = [shape_sine, shape_triangle, shape_saw, shape_square];
    let x = (t * 3.0).min(2.9999);
    let seg = x as usize;
    let fr = x - seg as f32;
    // Snap the very last frame to a pure square.
    let (seg, fr) = if t >= 1.0 { (2, 1.0) } else { (seg, fr) };
    for h in 1..MAX_HARMONICS {
        im[h] = lerp(shapes[seg](h), shapes[seg + 1](h), fr);
    }
}

fn pwm(t: f32, re: &mut [f32], _im: &mut [f32]) {
    // Centered pulse, duty 50% -> 5%.
    let duty = lerp(0.5, 0.05, t);
    for h in 1..MAX_HARMONICS {
        let hf = h as f32;
        re[h] = 2.0 / (PI * hf) * (PI * hf * duty).sin();
    }
}

fn harmonic_sweep(t: f32, _re: &mut [f32], im: &mut [f32]) {
    // Start at a sine and add harmonics one by one (up to 64), each at 1/h.
    let n = 1.0 + t * 63.0;
    for h in 1..MAX_HARMONICS {
        let hf = h as f32;
        let w = (n - hf + 1.0).clamp(0.0, 1.0);
        im[h] = w / hf;
    }
}

fn formant(t: f32, _re: &mut [f32], im: &mut [f32]) {
    // Vowel walk a -> e -> i -> o -> u, formants expressed in harmonics of a
    // 110 Hz reference so the table sounds vocal around A2..A3.
    const VOWELS: [[f32; 3]; 5] = [
        [730.0, 1090.0, 2440.0], // a
        [530.0, 1840.0, 2480.0], // e
        [270.0, 2290.0, 3010.0], // i
        [570.0, 840.0, 2410.0],  // o
        [300.0, 870.0, 2240.0],  // u
    ];
    const GAINS: [f32; 3] = [1.0, 0.6, 0.3];
    const WIDTHS: [f32; 3] = [90.0, 120.0, 160.0];
    let x = (t * 4.0).min(3.9999);
    let seg = x as usize;
    let fr = if t >= 1.0 { 1.0 } else { x - seg as f32 };
    let reference = 110.0;
    for h in 1..MAX_HARMONICS {
        let f = h as f32 * reference;
        let mut amp = 0.0;
        for k in 0..3 {
            let fk = lerp(VOWELS[seg][k], VOWELS[seg + 1][k], fr);
            let d = (f - fk) / WIDTHS[k];
            amp += GAINS[k] * (-0.5 * d * d).exp();
        }
        // Glottal-ish source tilt so the fundamental stays present.
        amp += 0.25 / h as f32;
        // Alternate signs for a pulse-like (not phasey) waveform.
        im[h] = if h % 2 == 1 { amp } else { -amp } / (h as f32).sqrt();
    }
}

fn digital(t: f32, re: &mut [f32], im: &mut [f32]) {
    // Bit-crushed sine with increasing phase folding: odd-harmonic heavy and harsh.
    let steps = lerp(12.0, 1.5, t);
    let fold = lerp(1.0, 3.0, t);
    let mut wave = vec![0.0f32; TABLE_SIZE];
    for (i, w) in wave.iter_mut().enumerate() {
        let x = i as f32 / TABLE_SIZE as f32;
        let s = (2.0 * PI * x).sin() * fold;
        // Triangle fold keeps it in -1..1.
        let folded = {
            let y = (s + 1.0).rem_euclid(4.0);
            if y < 2.0 { y - 1.0 } else { 3.0 - y }
        };
        *w = ((folded * steps).round() / steps).clamp(-1.0, 1.0);
    }
    spectrum_from_wave(&wave, re, im);
}

/// Generate the built-in library, in BUILTIN_TABLES order.
pub fn builtin_tables() -> Vec<Wavetable> {
    vec![
        Wavetable::from_spectra(FRAMES, basic),
        Wavetable::from_spectra(FRAMES, pwm),
        Wavetable::from_spectra(FRAMES, harmonic_sweep),
        Wavetable::from_spectra(FRAMES, formant),
        Wavetable::from_spectra(FRAMES, digital),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frames_are_normalized_and_finite() {
        for (ti, table) in builtin_tables().iter().enumerate() {
            for f in 0..table.frames {
                let peak = table.frame(0, f).iter().fold(0.0f32, |m, v| m.max(v.abs()));
                assert!(peak.is_finite());
                assert!((peak - 1.0).abs() < 1e-3, "table {ti} frame {f} peak {peak}");
                for l in 0..MIP_LEVELS {
                    assert!(table.frame(l, f).iter().all(|v| v.is_finite() && v.abs() < 2.0));
                }
            }
        }
    }

    #[test]
    fn basic_first_frame_is_sine() {
        let t = Wavetable::from_spectra(FRAMES, basic);
        let f = t.frame(0, 0);
        for i in (0..TABLE_SIZE).step_by(37) {
            let expect = (2.0 * PI * i as f32 / TABLE_SIZE as f32).sin();
            assert!((f[i] - expect).abs() < 1e-3, "i {i}: {} vs {expect}", f[i]);
        }
    }

    #[test]
    fn mip_levels_drop_harmonics() {
        let t = Wavetable::from_spectra(FRAMES, basic);
        // Saw-ish frame at top level vs. a high mip: the high mip is smoother.
        let rough = |x: &[f32]| x.windows(2).map(|w| (w[1] - w[0]).abs()).fold(0.0f32, f32::max);
        let saw = FRAMES * 2 / 3;
        assert!(rough(t.frame(8, saw)) < rough(t.frame(0, saw)) * 0.5);
        assert_eq!(Wavetable::level_for(20.0, 48000.0), 0);
        assert!(Wavetable::level_for(4000.0, 48000.0) >= 7);
    }
}
