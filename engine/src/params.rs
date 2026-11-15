//! Flat parameter IDs. MUST match `src/engine/params.ts` numerically.
//! Append only; never renumber. Units are the patch schema's engineering units.

/// Built-in table index into BUILTIN_TABLES (basic, pwm, harmonic-sweep, formant, digital).
pub const OSC_A_TABLE: u32 = 0;
/// 0..1, morphs across the table's frames.
pub const OSC_A_POSITION: u32 = 1;
/// 0..1 linear gain (0 when the osc is disabled).
pub const OSC_A_LEVEL: u32 = 2;
/// Integer octaves, -4..4.
pub const OSC_A_OCTAVE: u32 = 3;
/// Integer semitones, -12..12.
pub const OSC_A_SEMI: u32 = 4;
/// Cents, -100..100.
pub const OSC_A_FINE: u32 = 5;
/// Hz, 20..20000.
pub const FILTER_CUTOFF: u32 = 6;
/// 0..1.
pub const FILTER_RESONANCE: u32 = 7;
/// 0 = bypass, 1 = enabled.
pub const FILTER_ENABLED: u32 = 8;
/// Seconds.
pub const ENV1_ATTACK: u32 = 9;
/// Seconds.
pub const ENV1_DECAY: u32 = 10;
/// 0..1.
pub const ENV1_SUSTAIN: u32 = 11;
/// Seconds.
pub const ENV1_RELEASE: u32 = 12;
/// 0..1 linear gain.
pub const MASTER_VOLUME: u32 = 13;

/// Number of parameter IDs this engine understands.
pub const PARAM_COUNT: u32 = 14;
