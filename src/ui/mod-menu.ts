import { createMenuController } from "@ui-sdk/react/menu"

/** One "Modulate with" menu for every knob, opened by the knob under the right-click; its payload is the target path. */
export const modMenu = createMenuController<string>()
