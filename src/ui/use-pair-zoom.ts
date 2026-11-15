import * as React from "react"

/**
 * Scale the instrument and the AI device together: the pair keeps its designed
 * width and is zoomed down as one when the window is narrower, and its height
 * is set so that, zoomed, it fills the page exactly (never taller than 100dvh).
 */
export function usePairZoom() {
  const pageRef = React.useRef<HTMLElement>(null)
  const pairRef = React.useRef<HTMLDivElement>(null)
  React.useLayoutEffect(() => {
    const page = pageRef.current
    const pair = pairRef.current
    if (!page || !pair) return
    const fit = () => {
      pair.style.zoom = ""
      pair.style.height = ""
      const style = getComputedStyle(page)
      const room = page.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
      const tall = page.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
      const natural = pair.offsetWidth
      const zoom = natural > 0 && room > 0 ? Math.min(1, room / natural) : 1
      if (zoom < 1) pair.style.zoom = String(zoom)
      if (tall > 0) pair.style.height = `${tall / zoom}px`
    }
    fit()
    let frame = 0
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(fit)
    })
    observer?.observe(page)
    return () => {
      observer?.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [])
  return { pageRef, pairRef }
}
