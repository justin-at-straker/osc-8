// BYOK key storage. Keys live in this browser's IndexedDB and are read only to
// build a provider client that sends them straight to that provider. Never log
// a key, never put one in an error message.
//
// Where IndexedDB doesn't exist (jsdom, some private modes) an in-memory map
// stands in, so the app still works for the session and tests need no mock.
import type { Provider } from "./provider"

const DB_NAME = "osc8-ai"
const DB_VERSION = 1
const STORE = "keys"

const memory = new Map<Provider, string>()
let dbPromise: Promise<IDBDatabase> | null = null

function hasIndexedDb() {
  return typeof indexedDB !== "undefined" && indexedDB !== null
}

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(new Error("Couldn't open key storage (IndexedDB)."))
    req.onblocked = () => reject(new Error("Key storage is blocked by another tab."))
  }).catch((error: unknown) => {
    dbPromise = null
    throw error
  })
  return dbPromise
}

async function run<T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb()
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    const req = op(tx.objectStore(STORE))
    tx.oncomplete = () => resolve(req.result as T)
    tx.onerror = () => reject(new Error("Key storage request failed."))
    tx.onabort = () => reject(new Error("Key storage request was aborted."))
  })
}

/**
 * A key seeded by the dev server from `.env.local` (`OPENAI_API_KEY`), so local
 * development needs no pasting. vite.config.ts defines it as "" for builds, so
 * it can never reach a production bundle.
 */
function devKey(provider: Provider): string | null {
  if (provider !== "openai") return null
  const key = typeof __DEV_OPENAI_KEY__ === "string" ? __DEV_OPENAI_KEY__ : ""
  return key.length > 0 ? key : null
}

/** The stored key for a provider, or null when none is saved. */
export async function getKey(provider: Provider): Promise<string | null> {
  return (await getStoredKey(provider)) ?? devKey(provider)
}

/** Only what's saved in this browser, ignoring the dev-server key. */
export async function getStoredKey(provider: Provider): Promise<string | null> {
  if (!hasIndexedDb()) return memory.get(provider) ?? null
  const value = await run<unknown>("readonly", (s) => s.get(provider))
  return typeof value === "string" && value.length > 0 ? value : null
}

/** Whether a dev-server key is available for this provider (never the key itself). */
export function hasDevKey(provider: Provider): boolean {
  return devKey(provider) !== null
}

/** Save a provider key. Whitespace around a pasted key is trimmed. */
export async function setKey(provider: Provider, key: string): Promise<void> {
  const trimmed = key.trim()
  if (!trimmed) throw new Error("The key is empty.")
  if (!hasIndexedDb()) {
    memory.set(provider, trimmed)
    return
  }
  await run("readwrite", (s) => s.put(trimmed, provider))
}

/** Forget a provider key. */
export async function clearKey(provider: Provider): Promise<void> {
  if (!hasIndexedDb()) {
    memory.delete(provider)
    return
  }
  await run("readwrite", (s) => s.delete(provider))
}

/** "sk-ant-…a1b2": enough to recognise a key without showing it. */
export function maskKey(key: string): string {
  if (key.length <= 12) return "•".repeat(key.length)
  return `${key.slice(0, 7)}…${key.slice(-4)}`
}
