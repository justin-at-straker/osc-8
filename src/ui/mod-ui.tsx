import * as React from "react"
import { createPortal } from "react-dom"
import { Menu, MenuContent, MenuGroup, MenuGroupLabel, MenuItem, MenuSeparator } from "@ui-sdk/react/menu"
import { chosenItem } from "@/lib/chosen-item"
import { useStore } from "@/state/store"
import { beginModDrag, useModDrag } from "./mod-drag"
import { modMenu } from "./mod-menu"
import {
  addRoute,
  clearTarget,
  HANDLE_SOURCES,
  MAX_ROUTES,
  MENU_SOURCES,
  SOURCE_LABELS,
  sourceFamily,
  targetLabel,
  type ModSource,
} from "./mod-model"

/** The cross-arrows grip printed on a handle. */
function GripIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden data-osc-grip>
      <path d="M8 1.5v13M1.5 8h13M8 1.5 6 3.5M8 1.5l2 2M8 14.5l-2-2M8 14.5l2-2M1.5 8l2-2M1.5 8l2 2M14.5 8l-2-2M14.5 8l-2 2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

/**
 * A modulation source's handle: press and drag it onto a knob to route the
 * source there. Labelled "LFO 1 source" etc. for the agent and screen readers;
 * from the keyboard, a knob's context menu (Shift+F10) does the same.
 */
export function ModHandle({ source, legend, compact }: { source: ModSource; legend?: string; compact?: boolean }) {
  const dragging = useModDrag()?.source === source
  return (
    <button
      type="button"
      data-osc-mod-handle={compact ? "compact" : ""}
      data-family={sourceFamily(source)}
      data-dragging={dragging || undefined}
      aria-label={`${SOURCE_LABELS[source]} source`}
      title={`Drag ${SOURCE_LABELS[source]} onto a knob to modulate it`}
      onPointerDown={(event) => void beginModDrag(source, event)}
    >
      <GripIcon />
      {legend !== undefined && <span>{legend}</span>}
    </button>
  )
}

/** Every drag handle in one strip, visible whichever page is open. */
export function ModSourceStrip() {
  return (
    <div data-osc-mod-strip role="group" aria-label="Modulation sources">
      <span data-osc-mod-strip-legend aria-hidden>
        Mod
      </span>
      {HANDLE_SOURCES.map((source) => (
        <ModHandle key={source} source={source} legend={SOURCE_LABELS[source].replace(" ", "")} compact />
      ))}
    </div>
  )
}

/** The chip that follows the pointer while dragging a source. */
export function ModDragGhost() {
  const drag = useModDrag()
  const full = useStore((s) => s.patch.mod.length >= MAX_ROUTES)
  if (!drag) return null
  const text = drag.over
    ? full
      ? "Matrix full (16)"
      : `${SOURCE_LABELS[drag.source]} → ${targetLabel(drag.over)}`
    : SOURCE_LABELS[drag.source]
  return createPortal(
    <div data-osc-mod-ghost data-family={sourceFamily(drag.source)} style={{ left: drag.x, top: drag.y }} aria-hidden>
      {text}
    </div>,
    document.body
  )
}

/**
 * Makes a control a modulation target: it accepts a dropped handle (via
 * data-mod-target), and right-click, long-press or Shift+F10 opens
 * "Modulate with" LFO 1..4, Env 2/3, Velocity, Note, Random.
 */
export function ModTargetArea({ target, children }: { target: string; children: React.ReactNode }) {
  const press = React.useRef<{ x: number; y: number; timer: number } | null>(null)
  const open = (from: EventTarget | null) => {
    const anchor = (from as HTMLElement | null)?.closest?.("[data-param]") ?? (from as HTMLElement | null)
    void modMenu.open({ payload: target, anchor: (anchor as HTMLElement) ?? undefined })
  }
  const cancelPress = () => {
    if (press.current) clearTimeout(press.current.timer)
    press.current = null
  }
  return (
    <div
      data-mod-target={target}
      data-osc-mod-area
      style={{ display: "contents" }}
      onContextMenu={(event) => {
        event.preventDefault()
        open(event.target)
      }}
      onKeyDown={(event) => {
        if ((event.key === "F10" && event.shiftKey) || event.key === "ContextMenu") {
          event.preventDefault()
          open(event.target)
        }
      }}
      // Long-press on touch: hold still for half a second.
      onPointerDown={(event) => {
        if (event.pointerType !== "touch") return
        const el = event.target
        press.current = { x: event.clientX, y: event.clientY, timer: window.setTimeout(() => open(el), 550) }
      }}
      onPointerMove={(event) => {
        const p = press.current
        if (p && Math.hypot(event.clientX - p.x, event.clientY - p.y) > 8) cancelPress()
      }}
      onPointerUp={cancelPress}
      onPointerCancel={cancelPress}
    >
      {children}
    </div>
  )
}

/**
 * The shared "Modulate with" menu. Hidden from the UI SDK agent (it adds routes
 * with the Routes page's form instead), so the agent's snapshot isn't full of menus.
 */
export function ModMenuHost() {
  return (
    <div data-agent-hidden style={{ display: "contents" }}>
      <Menu
        controller={modMenu}
        onAction={(value) => {
          const target = modMenu.getPayload()
          if (!target) return
          if (value === "clear") clearTarget(target)
          else addRoute(value as ModSource, target)
        }}
      >
        <MenuContent<string> data-kit="popup" data-osc-mod-menu sideOffset={6}>
          {(state) => <ModMenuItems target={state.payload ?? ""} />}
        </MenuContent>
      </Menu>
    </div>
  )
}

function ModMenuItems({ target }: { target: string }) {
  const routed = useStore((s) => s.patch.mod.some((r) => r.target === target))
  const label = targetLabel(target)
  return (
    <>
      <MenuGroup>
        <MenuGroupLabel data-osc-menu-group>Modulate {label} with</MenuGroupLabel>
        {MENU_SOURCES.map((source) => (
          <MenuItem key={source} value={source} data-kit="option" data-family={sourceFamily(source)} {...chosenItem}>
            {SOURCE_LABELS[source]}
          </MenuItem>
        ))}
      </MenuGroup>
      {routed && (
        <>
          <MenuSeparator data-kit="separator" />
          <MenuItem value="clear" data-kit="option" {...chosenItem}>
            Remove modulation
          </MenuItem>
        </>
      )}
    </>
  )
}
