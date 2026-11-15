//! Small shared DSP building blocks: parameter smoothing, delay lines, filters.

use core::f32::consts::PI;

/// One-pole parameter smoother that snaps to its target when close.
#[derive(Clone, Copy, Debug)]
pub struct Smoother {
    pub value: f32,
    pub target: f32,
    coef: f32,
}

impl Smoother {
    pub fn new(value: f32) -> Self {
        Self { value, target: value, coef: 1.0 }
    }

    /// A smoother at `value` with a time constant of `seconds`.
    pub fn with_time(value: f32, seconds: f32, sample_rate: f32) -> Self {
        let mut s = Self::new(value);
        s.set_time(seconds, sample_rate);
        s
    }

    pub fn set_time(&mut self, seconds: f32, sample_rate: f32) {
        self.coef = 1.0 - (-1.0 / (seconds * sample_rate).max(1.0)).exp();
    }

    /// Jump straight to the target.
    pub fn snap(&mut self) {
        self.value = self.target;
    }

    #[inline]
    pub fn moving(&self) -> bool {
        self.value != self.target
    }

    #[inline]
    #[allow(clippy::should_implement_trait)]
    pub fn next(&mut self) -> f32 {
        let d = self.target - self.value;
        if d.abs() < 1e-4 {
            self.value = self.target;
        } else {
            self.value += d * self.coef;
        }
        self.value
    }
}

/// Power-of-two ring buffer delay line, allocated once.
pub struct DelayLine {
    buf: Vec<f32>,
    mask: usize,
    write: usize,
}

impl DelayLine {
    /// A line that can delay by at least `max_samples`.
    pub fn new(max_samples: usize) -> Self {
        let len = (max_samples + 4).next_power_of_two();
        Self { buf: vec![0.0; len], mask: len - 1, write: 0 }
    }

    pub fn max_delay(&self) -> f32 {
        (self.buf.len() - 3) as f32
    }

    pub fn clear(&mut self) {
        self.buf.iter_mut().for_each(|v| *v = 0.0);
        self.write = 0;
    }

    /// Read `delay` samples back (>= 1) with linear interpolation. Read before `push`.
    #[inline]
    pub fn read(&self, delay: f32) -> f32 {
        let d = delay.clamp(1.0, self.max_delay());
        let i = d as usize;
        let frac = d - i as f32;
        let a = self.buf[self.write.wrapping_sub(i) & self.mask];
        let b = self.buf[self.write.wrapping_sub(i + 1) & self.mask];
        a + (b - a) * frac
    }

    /// Read `delay` samples back (>= 2) with 4-point Catmull-Rom interpolation:
    /// keeps the top end that linear interpolation dulls on a modulated delay
    /// (Dattorro, Effect Design Part 2, 4.3). Read before `push`.
    #[inline]
    pub fn read_cubic(&self, delay: f32) -> f32 {
        let d = delay.clamp(2.0, self.max_delay() - 1.0);
        let i = d as usize;
        let t = d - i as f32;
        let at = |k: usize| self.buf[self.write.wrapping_sub(k) & self.mask];
        catmull_rom(at(i - 1), at(i), at(i + 1), at(i + 2), t)
    }

    /// Read an integer number of samples back (>= 1).
    #[inline]
    pub fn tap(&self, delay: usize) -> f32 {
        self.buf[self.write.wrapping_sub(delay) & self.mask]
    }

    #[inline]
    pub fn push(&mut self, x: f32) {
        self.buf[self.write] = x;
        self.write = (self.write + 1) & self.mask;
    }
}

/// 4-point Catmull-Rom interpolation between `x0` (t = 0) and `x1` (t = 1).
#[inline(always)]
pub fn catmull_rom(xm1: f32, x0: f32, x1: f32, x2: f32, t: f32) -> f32 {
    x0 + 0.5 * t * (x1 - xm1 + t * (2.0 * xm1 - 5.0 * x0 + 4.0 * x1 - x2 + t * (3.0 * (x0 - x1) + x2 - xm1)))
}

/// One-pole lowpass.
#[derive(Clone, Copy, Default)]
pub struct OnePole {
    pub a: f32,
    pub z: f32,
}

impl OnePole {
    pub fn set_cutoff(&mut self, hz: f32, sample_rate: f32) {
        self.a = 1.0 - (-2.0 * PI * hz / sample_rate).exp();
    }
    #[inline]
    pub fn lowpass(&mut self, x: f32) -> f32 {
        self.z += self.a * (x - self.z);
        self.z
    }
    #[inline]
    pub fn highpass(&mut self, x: f32) -> f32 {
        x - self.lowpass(x)
    }
}

/// RBJ biquad, transposed direct form II with f64 state (stable at low cutoffs).
#[derive(Clone, Copy, Debug)]
pub struct Biquad {
    b0: f64,
    b1: f64,
    b2: f64,
    a1: f64,
    a2: f64,
    z1: f64,
    z2: f64,
}

impl Default for Biquad {
    fn default() -> Self {
        Self::IDENTITY
    }
}

pub enum BiquadKind {
    Lowpass,
    /// Constant 0 dB peak gain.
    Bandpass,
    Highpass,
    Allpass,
    Peak(f32),
    LowShelf(f32),
    HighShelf(f32),
}

impl Biquad {
    /// Passes the input through unchanged.
    pub const IDENTITY: Self = Self { b0: 1.0, b1: 0.0, b2: 0.0, a1: 0.0, a2: 0.0, z1: 0.0, z2: 0.0 };

    pub fn new(kind: BiquadKind, hz: f32, q: f32, sample_rate: f32) -> Self {
        let mut b = Self::default();
        b.set(kind, hz, q, sample_rate);
        b
    }

    /// Set coefficients, keeping state. Gains (dB) are in the kind.
    pub fn set(&mut self, kind: BiquadKind, hz: f32, q: f32, sample_rate: f32) {
        let w0 = 2.0 * core::f64::consts::PI * (hz as f64 / sample_rate as f64).min(0.49);
        let (sn, cs) = w0.sin_cos();
        let alpha = sn / (2.0 * q as f64);
        let (b0, b1, b2, a0, a1, a2) = match kind {
            BiquadKind::Lowpass => ((1.0 - cs) / 2.0, 1.0 - cs, (1.0 - cs) / 2.0, 1.0 + alpha, -2.0 * cs, 1.0 - alpha),
            BiquadKind::Bandpass => (alpha, 0.0, -alpha, 1.0 + alpha, -2.0 * cs, 1.0 - alpha),
            BiquadKind::Highpass => ((1.0 + cs) / 2.0, -(1.0 + cs), (1.0 + cs) / 2.0, 1.0 + alpha, -2.0 * cs, 1.0 - alpha),
            BiquadKind::Allpass => (1.0 - alpha, -2.0 * cs, 1.0 + alpha, 1.0 + alpha, -2.0 * cs, 1.0 - alpha),
            BiquadKind::Peak(db) => {
                let a = 10f64.powf(db as f64 / 40.0);
                (1.0 + alpha * a, -2.0 * cs, 1.0 - alpha * a, 1.0 + alpha / a, -2.0 * cs, 1.0 - alpha / a)
            }
            BiquadKind::LowShelf(db) => {
                let a = 10f64.powf(db as f64 / 40.0);
                let s = 2.0 * a.sqrt() * alpha;
                (
                    a * ((a + 1.0) - (a - 1.0) * cs + s),
                    2.0 * a * ((a - 1.0) - (a + 1.0) * cs),
                    a * ((a + 1.0) - (a - 1.0) * cs - s),
                    (a + 1.0) + (a - 1.0) * cs + s,
                    -2.0 * ((a - 1.0) + (a + 1.0) * cs),
                    (a + 1.0) + (a - 1.0) * cs - s,
                )
            }
            BiquadKind::HighShelf(db) => {
                let a = 10f64.powf(db as f64 / 40.0);
                let s = 2.0 * a.sqrt() * alpha;
                (
                    a * ((a + 1.0) + (a - 1.0) * cs + s),
                    -2.0 * a * ((a - 1.0) + (a + 1.0) * cs),
                    a * ((a + 1.0) + (a - 1.0) * cs - s),
                    (a + 1.0) - (a - 1.0) * cs + s,
                    2.0 * ((a - 1.0) - (a + 1.0) * cs),
                    (a + 1.0) - (a - 1.0) * cs - s,
                )
            }
        };
        self.b0 = b0 / a0;
        self.b1 = b1 / a0;
        self.b2 = b2 / a0;
        self.a1 = a1 / a0;
        self.a2 = a2 / a0;
    }

    pub fn clear(&mut self) {
        self.z1 = 0.0;
        self.z2 = 0.0;
    }

    #[inline]
    pub fn process(&mut self, x: f32) -> f32 {
        let x = x as f64;
        let y = self.b0 * x + self.z1;
        self.z1 = self.b1 * x - self.a1 * y + self.z2;
        self.z2 = self.b2 * x - self.a2 * y;
        y as f32
    }
}

/// Cheap sine for LFOs: `phase` in turns (any real), error < 0.001.
#[inline]
pub fn fast_sin(phase: f32) -> f32 {
    let x = phase - phase.floor(); // 0..1
    let x = if x < 0.5 { x } else { x - 1.0 }; // -0.5..0.5
    let y = 8.0 * x - 16.0 * x * x.abs(); // parabola
    0.225 * (y * y.abs() - y) + y
}

#[inline]
pub fn db_to_gain(db: f32) -> f32 {
    (db * (core::f32::consts::LN_10 / 20.0)).exp()
}

#[inline]
pub fn gain_to_db(g: f32) -> f32 {
    g.max(1e-9).ln() * (20.0 / core::f32::consts::LN_10)
}

/// Taps of the shared 2x halfband (windowed sinc, Blackman).
pub const HALFBAND_TAPS: usize = 31;
pub const HALFBAND_CENTER: usize = HALFBAND_TAPS / 2; // 15
const TAPS: usize = HALFBAND_TAPS;
const CENTER: usize = HALFBAND_CENTER;

/// 2x up/down sampler for one channel (the distortion and the synth's 2x quality mode).
#[derive(Clone, Copy)]
pub struct Oversampler {
    /// Input history, newest first.
    x: [f32; CENTER + 1],
    /// 2x-rate history, newest first (one extra slot: we decimate on the even sample).
    v: [f32; TAPS + 1],
}

impl Oversampler {
    pub const fn new() -> Self {
        Self { x: [0.0; CENTER + 1], v: [0.0; TAPS + 1] }
    }

    /// Push one input sample, return the two 2x-rate samples (in time order).
    #[inline]
    pub fn up(&mut self, h: &[f32; TAPS], input: f32) -> (f32, f32) {
        self.x.copy_within(0..CENTER, 1);
        self.x[0] = input;
        // Zero-stuffed stream filtered by h with gain 2. Even 2x samples see the
        // even taps, odd ones the odd taps (only the center, for a halfband).
        let mut even = 0.0;
        for j in 0..=CENTER {
            even += h[2 * j] * self.x[j];
        }
        let mut odd = 0.0;
        for j in 0..CENTER {
            odd += h[2 * j + 1] * self.x[j];
        }
        (2.0 * even, 2.0 * odd)
    }

    /// Push two 2x-rate samples, return one decimated output.
    #[inline]
    pub fn down(&mut self, h: &[f32; TAPS], a: f32, b: f32) -> f32 {
        self.v.copy_within(0..TAPS - 1, 2);
        self.v[1] = a;
        self.v[0] = b;
        // Output aligned with `a` (the even sample) so latency is a whole number of input samples.
        let mut y = 0.0;
        for k in 0..TAPS {
            y += h[k] * self.v[k + 1];
        }
        y
    }
}

pub fn halfband() -> [f32; TAPS] {
    let mut h = [0.0f32; TAPS];
    let mut sum = 0.0;
    for (k, v) in h.iter_mut().enumerate() {
        let n = k as f64 - CENTER as f64;
        let sinc = if n == 0.0 { 1.0 } else { (core::f64::consts::PI * n / 2.0).sin() / (core::f64::consts::PI * n / 2.0) };
        let t = 2.0 * core::f64::consts::PI * k as f64 / (TAPS - 1) as f64;
        let w = 0.42 - 0.5 * t.cos() + 0.08 * (2.0 * t).cos(); // Blackman
        *v = (0.5 * sinc * w) as f32;
        sum += *v;
    }
    for v in h.iter_mut() {
        *v /= sum;
    }
    h
}
