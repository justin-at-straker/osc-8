//! ADSR envelope: linear attack, exponential decay/release. Used for the amp
//! envelope (env1) and the modulation envelopes (env2, env3).

const MIN_ATTACK: f32 = 0.001;
const MIN_DECAY: f32 = 0.001;
const MIN_RELEASE: f32 = 0.003;
/// Envelope "time" reaches ~1% (-40 dB) of the distance to its target.
const TIME_CONSTANTS: f32 = 4.6;
const SILENCE: f32 = 1e-4;
/// The analog attack charges toward this level and switches to decay on
/// crossing 1, like an RC circuit aimed past full scale (Surge's analog ADSR).
const ATTACK_TARGET: f32 = 1.5;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Stage {
    Idle,
    Attack,
    Decay,
    Sustain,
    Release,
}

/// Per-sample coefficients for an ADSR, derived from times in seconds.
#[derive(Clone, Copy, Debug)]
pub struct EnvParams {
    pub attack_inc: f32,
    /// Analog attack: per-sample approach toward `ATTACK_TARGET` (0 = linear attack).
    pub attack_coef: f32,
    pub decay_coef: f32,
    pub sustain: f32,
    pub release_coef: f32,
}

impl EnvParams {
    pub fn new(attack: f32, decay: f32, sustain: f32, release: f32, sample_rate: f32) -> Self {
        Self {
            attack_inc: 1.0 / (attack.max(MIN_ATTACK) * sample_rate),
            attack_coef: 0.0,
            decay_coef: (-TIME_CONSTANTS / (decay.max(MIN_DECAY) * sample_rate)).exp(),
            sustain: sustain.clamp(0.0, 1.0),
            release_coef: (-TIME_CONSTANTS / (release.max(MIN_RELEASE) * sample_rate)).exp(),
        }
    }

    /// Switch to the analog attack, timed so it still reaches full level in `attack` seconds:
    /// from 0 toward 1.5, the remaining distance is 1/3 at t = attack, so tau = attack / ln 3.
    pub fn with_analog_attack(mut self, attack: f32, sample_rate: f32) -> Self {
        let tau = attack.max(MIN_ATTACK) / 3.0f32.ln();
        self.attack_coef = 1.0 - (-1.0 / (tau * sample_rate)).exp();
        self
    }
}

/// Raw ADSR settings (seconds / 0..1) plus their derived coefficients.
#[derive(Clone, Copy, Debug)]
pub struct Adsr {
    pub attack: f32,
    pub decay: f32,
    pub sustain: f32,
    pub release: f32,
    /// Analog (RC) attack curve instead of linear.
    pub analog: bool,
    pub params: EnvParams,
}

impl Adsr {
    pub fn new(attack: f32, decay: f32, sustain: f32, release: f32, sample_rate: f32) -> Self {
        Self { attack, decay, sustain, release, analog: false, params: EnvParams::new(attack, decay, sustain, release, sample_rate) }
    }

    fn params_for(&self, attack: f32, decay: f32, release: f32, sample_rate: f32) -> EnvParams {
        let p = EnvParams::new(attack, decay, self.sustain, release, sample_rate);
        if self.analog { p.with_analog_attack(attack, sample_rate) } else { p }
    }

    /// Choose the analog (true) or linear attack curve.
    pub fn set_analog(&mut self, analog: bool, sample_rate: f32) {
        self.analog = analog;
        self.params = self.params_for(self.attack, self.decay, self.release, sample_rate);
    }

    /// Coefficients with the attack, decay and release times scaled by `scale`
    /// (per-voice analog variance).
    pub fn scaled(&self, scale: [f32; 3], sample_rate: f32) -> EnvParams {
        self.params_for(self.attack * scale[0], self.decay * scale[1], self.release * scale[2], sample_rate)
    }

    /// Set stage `index` (0 attack, 1 decay, 2 sustain, 3 release) and refresh coefficients.
    pub fn set(&mut self, index: usize, value: f32, sample_rate: f32) {
        match index {
            0 => self.attack = value.clamp(0.0, 20.0),
            1 => self.decay = value.clamp(0.0, 20.0),
            2 => self.sustain = value.clamp(0.0, 1.0),
            _ => self.release = value.clamp(0.0, 20.0),
        }
        self.params = self.params_for(self.attack, self.decay, self.release, sample_rate);
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Envelope {
    pub stage: Stage,
    pub level: f32,
}

impl Envelope {
    pub const IDLE: Self = Self { stage: Stage::Idle, level: 0.0 };

    pub fn active(&self) -> bool {
        self.stage != Stage::Idle
    }

    /// Start (or restart from the current level) the attack.
    pub fn gate_on(&mut self) {
        self.stage = Stage::Attack;
    }

    /// Legato: a released envelope heads back to sustain from where it is,
    /// without a new attack. Otherwise unchanged.
    pub fn resume(&mut self) {
        if self.stage == Stage::Release {
            self.stage = Stage::Decay;
        }
    }

    pub fn gate_off(&mut self) {
        if self.active() {
            self.stage = Stage::Release;
        }
    }

    #[inline]
    pub fn next(&mut self, p: &EnvParams) -> f32 {
        match self.stage {
            Stage::Idle => {}
            Stage::Attack => {
                if p.attack_coef > 0.0 {
                    self.level += (ATTACK_TARGET - self.level) * p.attack_coef;
                } else {
                    self.level += p.attack_inc;
                }
                if self.level >= 1.0 {
                    self.level = 1.0;
                    self.stage = Stage::Decay;
                }
            }
            Stage::Decay => {
                self.level = p.sustain + (self.level - p.sustain) * p.decay_coef;
                if (self.level - p.sustain).abs() < 1e-4 {
                    self.stage = Stage::Sustain;
                }
            }
            Stage::Sustain => {
                // Follow sustain changes smoothly.
                self.level = p.sustain + (self.level - p.sustain) * p.decay_coef;
            }
            Stage::Release => {
                self.level *= p.release_coef;
                if self.level < SILENCE {
                    self.level = 0.0;
                    self.stage = Stage::Idle;
                }
            }
        }
        self.level
    }

    /// Advance `n` samples.
    #[inline]
    pub fn advance(&mut self, p: &EnvParams, n: usize) -> f32 {
        if self.stage == Stage::Idle {
            return self.level;
        }
        for _ in 0..n {
            self.next(p);
        }
        self.level
    }
}
