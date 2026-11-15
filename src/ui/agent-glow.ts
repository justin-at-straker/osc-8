// Visual feedback for the AI: whatever the UI SDK agent changes glows in the
// key color for a moment, so the person sees it turning knobs and pressing cells.
export const GLOW_MS = 650

/** Light an element (or the element matching a selector, once it renders). */
export function glow(target: Element | string | null | undefined) {
  const light = (el: Element | null) => {
    if (!el) return
    el.setAttribute("data-agent-glow", "")
    const prior = Number(el.getAttribute("data-agent-glow-timer") || 0)
    if (prior) clearTimeout(prior)
    const timer = window.setTimeout(() => {
      el.removeAttribute("data-agent-glow")
      el.removeAttribute("data-agent-glow-timer")
    }, GLOW_MS)
    el.setAttribute("data-agent-glow-timer", String(timer))
  }
  if (typeof target !== "string") return light(target ?? null)
  // A selector: the element may appear on the next render (a bar the agent paged to).
  const now = document.querySelector(target)
  if (now) return light(now)
  requestAnimationFrame(() => light(document.querySelector(target)))
}

/** The element a person sees for a control with this accessible name: its data-param wrapper, or the control itself. */
export function elementForLabel(label: string): Element | null {
  const esc = (s: string) => (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(s) : s.split('"').join('\\"'))
  let el: Element | null = document.querySelector(`[aria-label="${esc(label)}"]`)
  if (!el) {
    // Named by a visible <label>/FieldLabel instead.
    for (const candidate of document.querySelectorAll("[aria-labelledby]")) {
      const ids = candidate.getAttribute("aria-labelledby")!.split(/\s+/)
      const text = ids.map((id) => document.getElementById(id)?.textContent?.trim() ?? "").join(" ").trim()
      if (text === label) {
        el = candidate
        break
      }
    }
  }
  return el?.closest("[data-param], [data-osc-track-switch], [data-osc-keyrow], [data-osc-follow]") ?? el
}
