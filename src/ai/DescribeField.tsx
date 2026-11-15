// The contextual "describe a sound" field for an instrument panel: type what you
// want, Generate runs the sound agent, Stop aborts it. Status and errors show
// on an LCD readout; a missing key opens KeySettings.
import * as React from "react"
import { Field, FieldLabel } from "@ui-sdk/react/field"
import { Input } from "@ui-sdk/react/input"
import { Button } from "@/components/ui/button"
import { Lcd } from "@/components/ui/lcd"
import { runSoundAgent } from "./agent"
import { KeySettings } from "./KeySettings"
import { DEFAULT_SETTINGS, errorMessage, MissingKeyError, type AiSettings } from "./provider"

type Status = { tone: "idle" | "busy" | "ok" | "error"; text: string }

export type DescribeFieldProps = {
  /** Field label. Defaults to "Describe a sound". */
  label?: string
  placeholder?: string
  settings?: AiSettings
  /** Called with the agent's summary after a successful run. */
  onDone?: (summary: string) => void
}

export function DescribeField({
  label = "Describe a sound",
  placeholder = "dark detuned reese, glassy pluck, a bit brighter...",
  settings = DEFAULT_SETTINGS,
  onDone,
}: DescribeFieldProps) {
  const [prompt, setPrompt] = React.useState("")
  const [status, setStatus] = React.useState<Status>({ tone: "idle", text: "READY" })
  const [keysOpen, setKeysOpen] = React.useState(false)
  const controller = React.useRef<AbortController | null>(null)
  const running = status.tone === "busy"

  React.useEffect(() => () => controller.current?.abort(), [])

  async function generate() {
    const text = prompt.trim()
    if (!text || running) return
    controller.current?.abort()
    const ac = new AbortController()
    controller.current = ac
    setStatus({ tone: "busy", text: "designing..." })
    try {
      const summary = await runSoundAgent({
        prompt: text,
        settings,
        signal: ac.signal,
        onStatus: (s) => {
          if (s.phase !== "done" && !ac.signal.aborted) setStatus({ tone: "busy", text: s.message })
        },
      })
      if (ac.signal.aborted) return
      setStatus({ tone: "ok", text: summary })
      onDone?.(summary)
    } catch (error) {
      if (ac.signal.aborted) return setStatus({ tone: "idle", text: "STOPPED" })
      if (error instanceof MissingKeyError) {
        setStatus({ tone: "error", text: "NO API KEY: ADD ONE TO START" })
        setKeysOpen(true)
        return
      }
      setStatus({ tone: "error", text: errorMessage(error) })
    } finally {
      if (controller.current === ac) controller.current = null
    }
  }

  function stop() {
    controller.current?.abort()
    setStatus({ tone: "idle", text: "STOPPED" })
  }

  return (
    // Hidden from the UI SDK agent so it can't type into its own prompt.
    <div data-agent-hidden data-ai="describe" style={{ display: "grid", gap: 8 }}>
      <form
        style={{ display: "flex", gap: 8, alignItems: "end" }}
        onSubmit={(event) => {
          event.preventDefault()
          void generate()
        }}
      >
        <Field data-kit="field" style={{ flex: 1 }}>
          <FieldLabel data-kit="label">{label}</FieldLabel>
          <Input
            data-kit="input"
            spellCheck={false}
            autoComplete="off"
            placeholder={placeholder}
            value={prompt}
            onValueChange={(value) => setPrompt(value)}
            readOnly={running}
          />
        </Field>
        {running ? (
          <Button type="button" tone="secondary" onClick={stop}>
            Stop
          </Button>
        ) : (
          <Button type="submit" tone="primary" disabled={!prompt.trim()}>
            Generate
          </Button>
        )}
        <Button type="button" tone="secondary" onClick={() => setKeysOpen(true)} aria-label="AI key settings">
          Key
        </Button>
      </form>
      <Lcd tag="AI" size="sm" role="status" aria-live="polite" data-tone={status.tone}>
        {status.text}
      </Lcd>
      <KeySettings
        open={keysOpen}
        onOpenChange={setKeysOpen}
        settings={settings}
        onKeyChange={(has) => has && setStatus({ tone: "idle", text: "KEY SAVED: READY" })}
      />
    </div>
  )
}
