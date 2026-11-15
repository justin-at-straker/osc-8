// Patch sharing (PLAN decision 20): patches export/import as `.osc8.json`.
import { Patch } from "@/engine/patch"
import { getState, replacePatch } from "./store"

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "patch"

export function exportPatch() {
  const patch = getState().patch
  const blob = new Blob([JSON.stringify(patch, null, 2)], { type: "application/json" })
  const url = URL.createObjectURL(blob)
  const a = Object.assign(document.createElement("a"), { href: url, download: `${slug(patch.name)}.osc8.json` })
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Parse and validate a patch file's text. Throws a readable error if it isn't a valid OSC-8 patch. */
export function parsePatchFile(text: string): Patch {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error("That file isn't JSON.")
  }
  const result = Patch.safeParse(json)
  if (!result.success) throw new Error("That file isn't a valid OSC-8 patch.")
  // A fresh id so an imported copy never collides with the patch it came from.
  return { ...result.data, id: crypto.randomUUID() }
}

/** Ask for a `.osc8.json` file and load it as the current patch (one undo step). Resolves false if cancelled. */
export function importPatch(): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const input = Object.assign(document.createElement("input"), { type: "file", accept: ".json,application/json" })
    input.addEventListener("cancel", () => resolve(false))
    input.addEventListener("change", async () => {
      const file = input.files?.[0]
      if (!file) return resolve(false)
      try {
        replacePatch(parsePatchFile(await file.text()), "load")
        resolve(true)
      } catch (error) {
        reject(error)
      }
    })
    input.click()
  })
}
