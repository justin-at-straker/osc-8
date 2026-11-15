// The app's menubar, built on the UI SDK menu primitives with the SPEC-01
// menubar markup (data-kit attributes), so the hardware skin styles it. The
// kit's own <Menubar> is a static demo without actions, disabled items or
// shortcuts, so this composes the primitives directly.
import * as React from "react"
import {
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuItem,
  MenuItemIndicator,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
} from "@ui-sdk/react/menu"
import { Menubar } from "@ui-sdk/react/menubar"
import { chosenItem } from "@/lib/chosen-item"
import { Icon } from "@/components/ui/icon"
import { onSoundChange, setSoundEnabled, soundEnabled } from "@/lib/sound"
import { defaultPatch } from "@/engine/patch"
import { canRedo, canUndo, redo, replacePatch, setPattern, setTransport, undo, useStore } from "@/state/store"
import { exportPatch, importPatch } from "@/state/patch-files"
import { clearStartup, exportSession, saveStartup } from "@/state/startup"
import { notify } from "@/components/ui/toaster"
import { loadPresetById, PRESETS_BY_CATEGORY, stepPreset } from "./preset-state"
import { pickMidiFile } from "@/midi/open"
import { togglePlay } from "./transport-actions"
import type { EngineControls } from "./types"

export type AppMenubarProps = {
  engine: EngineControls
  /** Open the AI key settings. */
  onOpenKeys?: () => void
  /** Report a failure (e.g. a bad patch file) to the person. */
  onError?: (message: string) => void
  /** Confirm something worked (e.g. a toast). */
  onNotice?: (title: string, description?: string) => void
  showHints: boolean
  onShowHintsChange: (on: boolean) => void
}

type Item = { value: string; label: string; shortcut?: string; disabled?: boolean; hint?: string }

function Items({ items }: { items: (Item | "-")[] }) {
  return items.map((item, i) =>
    item === "-" ? (
      <MenuSeparator key={`sep-${i}`} data-kit="separator" />
    ) : (
      <MenuItem
        key={item.value}
        value={item.value}
        data-kit="option"
        shortcut={item.shortcut}
        disabled={item.disabled}
        title={item.hint}
        {...chosenItem}
      >
        {item.label}
      </MenuItem>
    )
  )
}

function useSoundEnabled() {
  return React.useSyncExternalStore(onSoundChange, soundEnabled)
}

function focusDescribe() {
  document.querySelector<HTMLElement>('[data-ai="describe"] textarea, [data-ai="describe"] input')?.focus()
}

/** Every note off: stop the sequencer and release any held keys. */
function panic(engine: EngineControls) {
  setTransport({ playing: false })
  for (let note = 0; note < 128; note++) engine.noteOff(note)
}

export function AppMenubar({ engine, onOpenKeys, onError, onNotice = (title, description) => notify({ title, description }), showHints, onShowHintsChange }: AppMenubarProps) {
  const playing = useStore((s) => s.transport.playing)
  const audio = useStore((s) => s.audio)
  // Re-read undo depth whenever the patch changes.
  useStore((s) => s.patch)
  const sound = useSoundEnabled()

  const run = (value: string) => {
    switch (value) {
      case "init-patch":
        return void replacePatch(defaultPatch(crypto.randomUUID()), "load")
      case "next-preset":
        return void stepPreset(1)
      case "prev-preset":
        return void stepPreset(-1)
      case "import-patch":
        return importPatch().catch((e: Error) => onError?.(e.message))
      case "save-startup":
        return saveStartup()
          ? onNotice?.("Saved as startup default", "OSC-8 will open with this sound, pattern, beat and tempo in this browser.")
          : onError?.("Couldn't save: this browser blocks local storage.")
      case "export-session":
        exportSession()
        return onNotice?.("Session exported", "Move it to src/default-session.json to build it in as your app's default.")
      case "reset-startup":
        clearStartup()
        return onNotice?.("Startup default reset", "OSC-8 will open with the factory demo next time.")
      case "export-patch":
        return exportPatch()
      case "import-midi":
        return pickMidiFile()
      case "undo":
        return undo()
      case "redo":
        return redo()
      case "clear-pattern":
        return setPattern({ steps: 16, notes: [] })
      case "play":
        return togglePlay(engine)
      case "start-audio":
        return void engine.start().catch(() => {})
      case "panic":
        return panic(engine)
      case "describe":
        // After the menu closes and returns focus to its trigger.
        return void setTimeout(focusDescribe, 0)
      case "keys":
        return onOpenKeys?.()
      default:
        loadPresetById(value)
    }
  }

  return (
    <Menubar data-kit="menubar" aria-label="OSC-8">
      <Menu onAction={run}>
        <MenuTrigger data-kit="menubar-trigger">File</MenuTrigger>
        <MenuContent data-kit="popup" align="start" sideOffset={14}>
          <Items
            items={[
              { value: "init-patch", label: "Init patch" },
              "-",
              { value: "import-patch", label: "Import patch…" },
              { value: "export-patch", label: "Export patch…" },
              { value: "import-midi", label: "Import MIDI…" },
              "-",
              { value: "save-startup", label: "Save as startup default" },
              { value: "reset-startup", label: "Reset startup default" },
              { value: "export-session", label: "Export session…" },
              "-",
              { value: "save-project", label: "Save project", disabled: true, hint: "Coming in M4" },
              { value: "export-wav", label: "Export WAV…", disabled: true, hint: "Coming in M4" },
            ]}
          />
        </MenuContent>
      </Menu>

      <Menu onAction={run}>
        <MenuTrigger data-kit="menubar-trigger">Presets</MenuTrigger>
        <MenuContent data-kit="popup" align="start" sideOffset={14}>
          <Items
            items={[
              { value: "prev-preset", label: "Previous preset" },
              { value: "next-preset", label: "Next preset" },
              "-",
            ]}
          />
          {PRESETS_BY_CATEGORY.map((group) => (
            <MenuSub key={group.category}>
              <MenuSubTrigger data-kit="option" data-osc-submenu>
                {group.label}
                <span data-osc-submenu-arrow aria-hidden>
                  <Icon name="next" />
                </span>
              </MenuSubTrigger>
              <MenuSubContent data-kit="popup" sideOffset={6}>
                <Items items={group.presets.map((p) => ({ value: p.id, label: p.name }))} />
              </MenuSubContent>
            </MenuSub>
          ))}
        </MenuContent>
      </Menu>

      <Menu onAction={run}>
        <MenuTrigger data-kit="menubar-trigger">Edit</MenuTrigger>
        <MenuContent data-kit="popup" align="start" sideOffset={14}>
          <Items
            items={[
              { value: "undo", label: "Undo", shortcut: "mod+z", disabled: !canUndo() },
              { value: "redo", label: "Redo", shortcut: "mod+shift+z", disabled: !canRedo() },
              "-",
              { value: "clear-pattern", label: "Clear pattern" },
            ]}
          />
        </MenuContent>
      </Menu>

      <Menu onAction={run}>
        <MenuTrigger data-kit="menubar-trigger">Transport</MenuTrigger>
        <MenuContent data-kit="popup" align="start" sideOffset={14}>
          <Items
            items={[
              { value: "play", label: playing ? "Stop" : "Play", shortcut: "space" },
              "-",
              { value: "start-audio", label: "Start audio", disabled: audio === "on" || audio === "starting" },
              { value: "panic", label: "All notes off" },
            ]}
          />
        </MenuContent>
      </Menu>

      <Menu onAction={run}>
        <MenuTrigger data-kit="menubar-trigger">AI</MenuTrigger>
        <MenuContent data-kit="popup" align="start" sideOffset={14}>
          <Items
            items={[
              { value: "describe", label: "Describe a sound…" },
              { value: "variations", label: "Variations", disabled: true, hint: "Coming in M5" },
              "-",
              { value: "keys", label: "API key…" },
            ]}
          />
        </MenuContent>
      </Menu>

      <Menu>
        <MenuTrigger data-kit="menubar-trigger">View</MenuTrigger>
        <MenuContent data-kit="popup" align="start" sideOffset={14}>
          <MenuCheckboxItem value="sounds" data-kit="option" checked={sound} onCheckedChange={setSoundEnabled}>
            <MenuItemIndicator data-kit="option-check" keepMounted>
              ✓
            </MenuItemIndicator>
            Interface sounds
          </MenuCheckboxItem>
          <MenuCheckboxItem value="hints" data-kit="option" checked={showHints} onCheckedChange={onShowHintsChange}>
            <MenuItemIndicator data-kit="option-check" keepMounted>
              ✓
            </MenuItemIndicator>
            Key hints
          </MenuCheckboxItem>
        </MenuContent>
      </Menu>
    </Menubar>
  )
}
