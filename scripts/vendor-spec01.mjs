// Mirrors SPEC-01 registry items locally, rewriting the unpublished
// @ui-sdk snapshot pin to a published version, then they can be `shadcn add`ed.
import { mkdir, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

const BASE = "https://spec-01.vercel.app/r/"
const UI_SDK = "0.1.0-beta.2"
const out = resolve(process.argv[2] ?? ".spec01")
const roots = process.argv.slice(3)
await mkdir(out, { recursive: true })
const seen = new Set()
async function fetchItem(name) {
  if (seen.has(name)) return
  seen.add(name)
  const item = await (await fetch(`${BASE}${name}.json`)).json()
  item.dependencies = (item.dependencies ?? []).map((d) =>
    d.replace(/^(@ui-sdk\/(?:core|react))@0\.0\.0-.*$/, `$1@${UI_SDK}`))
  const deps = (item.registryDependencies ?? []).map((u) => u.replace(BASE, "").replace(/\.json$/, ""))
  // All transitive items are fetched and passed to `shadcn add` together, so
  // the cross-references are dropped (local Windows paths break shadcn).
  item.registryDependencies = []
  await writeFile(resolve(out, `${name}.json`), JSON.stringify(item, null, 2))
  for (const d of deps) await fetchItem(d)
}
for (const r of roots) await fetchItem(r)
console.log([...seen].join(" "))
