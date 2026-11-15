//! The `Instrument` trait: anything a track can play. The sequencer and
//! engine only talk to instruments through this, so new instrument types
//! (drum sampler, ...) plug in without touching timing or mixing.

use crate::modulation::GlobalMod;

pub trait Instrument {
    /// Start a note. `velocity` is 0..1.
    fn note_on(&mut self, note: u8, velocity: f32);
    /// Release a note (enter the release stage).
    fn note_off(&mut self, note: u8);
    /// Release every sounding note.
    fn all_notes_off(&mut self);
    /// Set a parameter by its flat ID (see `params.rs`), in engineering units.
    fn set_param(&mut self, id: u32, value: f32);
    /// Render into `left`/`right` (same length), overwriting their contents.
    fn render(&mut self, left: &mut [f32], right: &mut [f32]);
    /// Tempo, for tempo-synced modulation.
    fn set_bpm(&mut self, _bpm: f32) {}
    /// Mod wheel, 0..1.
    fn set_modwheel(&mut self, _value: f32) {}
    /// Monophonic ("most recent note") modulation for global targets (master, FX)
    /// and for UI readback. `None` if the instrument has no modulation.
    fn global_mod(&self) -> Option<&GlobalMod> {
        None
    }
}
