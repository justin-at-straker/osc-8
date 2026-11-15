// BYOK key dialog: paste, test, save or clear the provider key. The key lives in
// this browser (IndexedDB) and is sent only to the provider's API.
import * as React from "react"
import { Dialog, DialogBackdrop, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@ui-sdk/react/dialog"
import { Field, FieldLabel } from "@ui-sdk/react/field"
import { Input } from "@ui-sdk/react/input"
import { Button } from "@/components/ui/button"
import { Lcd } from "@/components/ui/lcd"
import { clearKey, getStoredKey, hasDevKey, maskKey, setKey } from "./keys"
import { DEFAULT_SETTINGS, errorMessage, PROVIDER_LABELS, testKey, type AiSettings } from "./provider"

type Readout = { tone: "idle" | "busy" | "ok" | "error"; text: string }

export type KeySettingsProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Provider and model the key is for. Defaults to OpenAI / gpt-6-luna. */
  settings?: AiSettings
  /** Called after a key is saved or cleared. */
  onKeyChange?: (hasKey: boolean) => void
}

export function KeySettings({ open, onOpenChange, settings = DEFAULT_SETTINGS, onKeyChange }: KeySettingsProps) {
  const label = PROVIDER_LABELS[settings.provider]
  const [draft, setDraft] = React.useState("")
  const [stored, setStored] = React.useState<string | null>(null)
  const [readout, setReadout] = React.useState<Readout>({ tone: "idle", text: "READING..." })
  const testAbort = React.useRef<AbortController | null>(null)

  const idleReadout = React.useCallback(
    (key: string | null): Readout =>
      key
        ? { tone: "ok", text: `SAVED ${maskKey(key)}` }
        : hasDevKey(settings.provider)
          ? { tone: "ok", text: "DEV KEY FROM .env.local" }
          : { tone: "idle", text: "NO KEY" },
    [settings.provider]
  )

  React.useEffect(() => {
    if (!open) return
    let live = true
    getStoredKey(settings.provider)
      .then((key) => {
        if (!live) return
        setStored(key)
        setReadout(idleReadout(key))
      })
      .catch((error: unknown) => live && setReadout({ tone: "error", text: errorMessage(error) }))
    return () => {
      live = false
      testAbort.current?.abort()
    }
  }, [open, settings.provider, idleReadout])

  const candidate = draft.trim() || stored

  async function onTest() {
    if (!candidate) return setReadout({ tone: "error", text: "PASTE A KEY FIRST" })
    testAbort.current?.abort()
    const controller = new AbortController()
    testAbort.current = controller
    setReadout({ tone: "busy", text: "TESTING..." })
    try {
      await testKey(settings, candidate, controller.signal)
      setReadout({ tone: "ok", text: `KEY OK · ${settings.model}` })
    } catch (error) {
      if (!controller.signal.aborted) setReadout({ tone: "error", text: errorMessage(error) })
    }
  }

  async function onSave() {
    const key = draft.trim()
    if (!key) return setReadout({ tone: "error", text: "PASTE A KEY FIRST" })
    try {
      await setKey(settings.provider, key)
      setStored(key)
      setDraft("")
      setReadout({ tone: "ok", text: `SAVED ${maskKey(key)}` })
      onKeyChange?.(true)
    } catch (error) {
      setReadout({ tone: "error", text: errorMessage(error) })
    }
  }

  async function onClear() {
    try {
      await clearKey(settings.provider)
      setStored(null)
      setDraft("")
      setReadout(idleReadout(null))
      onKeyChange?.(hasDevKey(settings.provider))
    } catch (error) {
      setReadout({ tone: "error", text: errorMessage(error) })
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Never keep a pasted, unsaved key around after the dialog closes.
        if (!next) setDraft("")
        onOpenChange(next)
      }}
    >
      <DialogBackdrop data-kit="backdrop" />
      {/* Hidden from the UI SDK agent: the model never sees or types into this. */}
      <DialogContent data-kit="dialog" data-agent-hidden>
        <div data-kit="dialog-surface" style={{ display: "grid", gap: 16 }}>
          <DialogTitle data-kit="dialog-title">{label} key</DialogTitle>
          <DialogDescription data-kit="dialog-description">
            Bring your own {label} API key. It stays in this browser and is sent only to {label}, straight from this page.
            OSC-8 has no server and never sees it. Usage is billed to your {label} account.
          </DialogDescription>

          <Lcd tag="KEY" size="sm" role="status" aria-live="polite" data-tone={readout.tone}>
            {readout.text}
          </Lcd>

          <Field data-kit="field" data-agent-secret>
            <FieldLabel data-kit="label">{label} API key</FieldLabel>
            <Input
              data-kit="input"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={stored ? maskKey(stored) : "sk-..."}
              value={draft}
              onValueChange={(value) => setDraft(value)}
            />
          </Field>

          <div data-kit="actions">
            <Button tone="secondary" onClick={onClear} disabled={!stored}>
              Clear
            </Button>
            <Button tone="secondary" onClick={onTest} disabled={!candidate || readout.tone === "busy"}>
              Test
            </Button>
            <Button tone="primary" onClick={onSave} disabled={!draft.trim()}>
              Save
            </Button>
            <DialogClose data-kit="button" data-tone="secondary">
              Close
            </DialogClose>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
