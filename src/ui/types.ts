/** The few imperative things the UI asks of the audio engine. Everything else goes through the store. */
export type EngineControls = {
  start(): Promise<void>
  noteOn(note: number, velocity: number): void
  noteOff(note: number): void
  /** Audition one 808 voice (index into DRUM_VOICES), if the engine supports it. */
  triggerDrum?(voice: number, velocity: number): void
}
