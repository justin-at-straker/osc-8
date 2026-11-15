import * as React from "react"
import { useStore } from "@/state/store"
import type { EngineControls } from "./types"

// Browsers won't start audio without a gesture, so until the engine is on the
// instrument sits behind a power switch. The engine bridge moves store
// `audio` through starting -> on (or error); a rejected start() is shown too.
export function AudioGate({ engine }: { engine: EngineControls }) {
  const audio = useStore((s) => s.audio)
  const [failed, setFailed] = React.useState<string | null>(null)
  if (audio === "on") return null

  const state = failed && audio !== "starting" ? "error" : audio
  const start = () => {
    if (audio === "starting") return
    setFailed(null)
    engine.start().catch((error: unknown) => setFailed(error instanceof Error ? error.message : String(error)))
  }

  const caption =
    state === "starting" ? "Starting audio" : state === "error" ? "Audio failed to start. Tap to retry" : "Tap to start audio"
  return (
    <div data-osc-gate data-state={state}>
      <button
        type="button"
        data-osc-power
        aria-label={caption}
        aria-busy={state === "starting" || undefined}
        disabled={state === "starting"}
        onClick={start}
        // The gate is the first thing to press; Enter or Space works straight away.
        autoFocus
      >
        <span data-osc-power-ring aria-hidden>
          <svg viewBox="0 0 24 24" aria-hidden>
            <path d="M12 3v8M7 6.5a7 7 0 1 0 10 0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </span>
        <span data-osc-power-led aria-hidden />
      </button>
      <p data-osc-gate-caption aria-live="polite">
        {caption}
        {state === "error" && failed && <small>{failed}</small>}
      </p>
    </div>
  )
}
