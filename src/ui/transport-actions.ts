import { getState, setTransport } from "@/state/store"
import type { EngineControls } from "./types"

export const MIN_BPM = 60
export const MAX_BPM = 200

/** Play or stop. Starting playback also starts audio if it isn't running yet, since the press is a user gesture. */
export function togglePlay(engine?: EngineControls) {
  const { transport, audio } = getState()
  if (!transport.playing && audio === "off" && engine) void engine.start().catch(() => {})
  setTransport({ playing: !transport.playing })
}
