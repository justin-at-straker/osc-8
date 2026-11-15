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


// FX chain, in signal order: distortion -> chorus -> delay -> reverb -> ott -> eq.
// Enums arrive as their index in patch.ts; booleans as 0/1.

/// 0/1.
pub const FX_DIST_ENABLED: u32 = 14;
/// DIST_TYPES index: tube, soft, hard, fold, bitcrush.
pub const FX_DIST_TYPE: u32 = 15;
/// 0..1.
pub const FX_DIST_DRIVE: u32 = 16;
/// 0..1 dry/wet.
pub const FX_DIST_MIX: u32 = 17;
/// 0/1.
pub const FX_CHORUS_ENABLED: u32 = 18;
/// Hz, 0.01..10.
pub const FX_CHORUS_RATE: u32 = 19;
/// 0..1.
pub const FX_CHORUS_DEPTH: u32 = 20;
/// 0..1 dry/wet.
pub const FX_CHORUS_MIX: u32 = 21;
/// 0/1.
pub const FX_DELAY_ENABLED: u32 = 22;
/// DELAY_TIMES index: 1/4, 1/8, 1/8d, 1/16, 1/4t (tempo-synced).
pub const FX_DELAY_TIME: u32 = 23;
/// 0..1.
pub const FX_DELAY_FEEDBACK: u32 = 24;
/// 0..1 dry/wet.
pub const FX_DELAY_MIX: u32 = 25;
/// 0/1.
pub const FX_DELAY_PING_PONG: u32 = 26;
/// 0/1.
pub const FX_REVERB_ENABLED: u32 = 27;
/// 0..1.
pub const FX_REVERB_SIZE: u32 = 28;
/// 0..1.
pub const FX_REVERB_DECAY: u32 = 29;
/// 0..1.
pub const FX_REVERB_DAMPING: u32 = 30;
/// 0..1 dry/wet.
pub const FX_REVERB_MIX: u32 = 31;
/// 0/1.
pub const FX_OTT_ENABLED: u32 = 32;
/// 0..1 amount.
pub const FX_OTT_DEPTH: u32 = 33;
/// 0..1 attack/release scaling.
pub const FX_OTT_TIME: u32 = 34;
/// 0/1.
pub const FX_EQ_ENABLED: u32 = 35;
/// dB, -12..12 (low shelf ~200 Hz).
pub const FX_EQ_LOW: u32 = 36;
/// dB, -12..12 (peak ~1.5 kHz).
pub const FX_EQ_MID: u32 = 37;
/// dB, -12..12 (high shelf ~6 kHz).
pub const FX_EQ_HIGH: u32 = 38;

/// First FX parameter ID.
pub const FX_FIRST: u32 = FX_DIST_ENABLED;

/// Plain (non-modulation) parameters are IDs 0..BASE_PARAM_COUNT; mod targets live here.
pub const BASE_PARAM_COUNT: u32 = 39;

// Modulation (IDs 39..130). Generated in params.ts; mirrored as bases + strides.

/// LFO `i` (0..4) at `LFO_BASE + i * LFO_STRIDE`: shape, rate, sync, syncDivision, oneShot.
pub const LFO_BASE: u32 = 39;
pub const LFO_STRIDE: u32 = 5;
pub const LFO_COUNT: u32 = 4;
/// LFO field offsets.
pub const LFO_SHAPE: u32 = 0; // LFO_SHAPES index: sine, triangle, saw, square, random
pub const LFO_RATE: u32 = 1; // Hz 0.01..50 (free-running)
pub const LFO_SYNC: u32 = 2; // 0/1
pub const LFO_DIVISION: u32 = 3; // 1/1, 1/2, 1/4, 1/8, 1/16, 1/4t, 1/8t, 1/8d
pub const LFO_ONE_SHOT: u32 = 4; // 0/1
/// env2 at ENV_BASE..+4, env3 at ENV_BASE+4..+8 (attack, decay, sustain, release; env1 units).
pub const ENV_BASE: u32 = 59;
pub const ENV_STRIDE: u32 = 4;
/// Mod slot `s` (0..16) at `MOD_BASE + s * MOD_STRIDE`: source, target, amount, aux.
pub const MOD_BASE: u32 = 67;
pub const MOD_STRIDE: u32 = 4;
pub const MOD_SLOTS: u32 = 16;
pub const MOD_SOURCE: u32 = 0; // MOD_SOURCES index
pub const MOD_TARGET: u32 = 1; // param ID, -1 = none
pub const MOD_AMOUNT: u32 = 2; // -1..1
pub const MOD_AUX: u32 = 3; // MOD_SOURCES index; scales amount by the aux source (0..1)

/// Number of parameter IDs this engine understands.
pub const PARAM_COUNT: u32 = MOD_BASE + MOD_SLOTS * MOD_STRIDE; // 131
