// Create the UI SDK agent bridge before render so it sees every component as it mounts.
import "@/ai/ui-agent"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./index.css"
import { App } from "./App.tsx"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
