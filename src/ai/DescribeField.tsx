// The AI module: type what you want, Generate runs the sound agent, Stop
// aborts it. Each step the agent reports lands in a small action log; the
// final summary and errors show on an LCD; a missing key opens KeySettings.
import * as React from "react"
import { Field, FieldLabel } from "@ui-sdk/react/field"
import { Textarea } from "@ui-sdk/react/textarea"
import { Button } from "@/components/ui/button"
import { DevicePlate } from "@/components/ui/device"
import { Lcd } from "@/components/ui/lcd"
import { runSoundAgent } from "./agent"
import { KeySettings } from "./KeySettings"
import { DEFAULT_SETTINGS, errorMessage, MissingKeyError, type AiSettings } from "./provider"

type Status = { tone: "idle" | "busy" | "ok" | "error"; text: string }

export type DescribeFieldProps = {
  /** Field label. Defaults to "Describe a sound or a groove". */
  label?: string
  placeholder?: string
  settings?: AiSettings
  /** Called with the agent's summary after a successful run. */
  onDone?: (summary: string) => void
}

export function DescribeField({
  label = "Describe a sound or a groove",
  placeholder = "dark reese with a rolling dnb bassline, glassy pluck arp in A minor, a bit brighter...",
  settings = DEFAULT_SETTINGS,
  onDone,
}: DescribeFieldProps) {
  const [prompt, setPrompt] = React.useState("")
  const [status, setStatus] = React.useState<Status>({ tone: "idle", text: "READY" })
  const [keysOpen, setKeysOpen] = React.useState(false)
  // The agent's steps, in plain words, newest last.
  const [log, setLog] = React.useState<string[]>([])
  // The plate's light: idle, thinking (the model is deciding), acting (a step is running), error.
  const [activity, setActivity] = React.useState<"idle" | "thinking" | "acting" | "error">("idle")
  const logList = React.useRef<HTMLOListElement>(null)
  // Keep the newest line in view, scrolling only the log (never the page).
  React.useEffect(() => {
    const el = logList.current
    if (el) el.scrollTop = el.scrollHeight
  }, [log])
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
    setActivity("thinking")
    setLog([])
    try {
      const summary = await runSoundAgent({
        prompt: text,
        settings,
        signal: ac.signal,
        onStatus: (s) => {
          if (ac.signal.aborted) return
          setActivity(s.phase === "tool" ? "acting" : s.phase === "done" ? "idle" : "thinking")
          if (s.phase !== "done") setStatus({ tone: "busy", text: s.message })
          if (s.phase === "tool" || s.phase === "starting") setLog((lines) => (lines.at(-1) === s.message ? lines : [...lines, s.message].slice(-200)))
        },
      })
      if (ac.signal.aborted) return
      setActivity("idle")
      setStatus({ tone: "ok", text: summary })
      onDone?.(summary)
    } catch (error) {
      if (ac.signal.aborted) {
        setActivity("idle")
        return setStatus({ tone: "idle", text: "STOPPED" })
      }
      setActivity("error")
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
    setActivity("idle")
    setStatus({ tone: "idle", text: "STOPPED" })
  }

  return (
    // Hidden from the UI SDK agent so it can't type into its own prompt.
    <div data-agent-hidden data-ai="describe" data-osc-ai-module>
      <header data-osc-ai-head>
        <DevicePlate model="AI-1" name="Sound agent" on={running} />
        <span data-osc-ai-led data-state={activity} title={activity} aria-label={`AI ${activity}`} role="img" />
        <Button type="button" tone="secondary" onClick={() => setKeysOpen(true)} aria-label="AI key settings" data-osc-ai-key>
          Key
        </Button>
      </header>
      <form
        data-osc-ai-form
        onSubmit={(event) => {
          event.preventDefault()
          void generate()
        }}
      >
        <Field data-kit="field" data-osc-ai-field>
          <FieldLabel data-kit="label">{label}</FieldLabel>
          <Textarea
            data-kit="input"
            data-osc-ai-prompt
            spellCheck={false}
            autoComplete="off"
            placeholder={placeholder}
            value={prompt}
            onValueChange={(value) => setPrompt(value)}
            readOnly={running}
            submitShortcut="mod+enter"
            rows={3}
          />
        </Field>
        <div data-osc-ai-actions>
          <Button type="submit" tone="primary" disabled={!prompt.trim() || running}>
            Generate
          </Button>
          <Button type="button" tone="secondary" onClick={stop} disabled={!running}>
            Stop
          </Button>
        </div>
      </form>
      <div data-osc-ai-log-screen>
        <ol ref={logList} data-osc-ai-log aria-label="AI actions" aria-live="polite">
          {log.length === 0 && <li data-osc-ai-log-empty>The AI's steps show here.</li>}
          {log.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ol>
      </div>
      <Lcd tag="AI" size="sm" role="status" aria-live="polite" data-tone={status.tone} data-osc-ai-status>
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
