/** The few imperative things the UI asks of the audio engine. Everything else goes through the store. */
export type EngineControls = {
  start(): Promise<void>
  noteOn(note: number, velocity: number): void
  noteOff(note: number): void
}
