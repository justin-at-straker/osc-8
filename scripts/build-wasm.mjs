// Build the Rust engine to WASM and copy it to src/engine/osc8.wasm.
// The .wasm is checked in because Vercel's build image has no Rust toolchain.
import { spawnSync } from "node:child_process"
import { copyFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { delimiter, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const manifest = join(root, "engine", "Cargo.toml")
const target = "wasm32-unknown-unknown"
const built = join(root, "engine", "target", target, "release", "osc8_engine.wasm")
const dest = join(root, "src", "engine", "osc8.wasm")

const env = { ...process.env }
const hasCargo = spawnSync("cargo", ["--version"], { env, stdio: "ignore" }).status === 0
if (!hasCargo) {
  const cargoBin = join(homedir(), ".cargo", "bin")
  const key = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH"
  env[key] = `${cargoBin}${delimiter}${env[key] ?? ""}`
}

const result = spawnSync("cargo", ["build", "--release", "--target", target, "--manifest-path", manifest], {
  cwd: root,
  env,
  stdio: "inherit",
})
if (result.error) {
  console.error(`build-wasm: could not run cargo (${result.error.message}). Install Rust and the ${target} target.`)
  process.exit(1)
}
if (result.status !== 0) process.exit(result.status ?? 1)

copyFileSync(built, dest)
console.log(`build-wasm: ${dest} (${(statSync(dest).size / 1024).toFixed(1)} KiB)`)
