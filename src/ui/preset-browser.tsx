import { Menu, MenuContent, MenuGroup, MenuGroupLabel, MenuItem, MenuTrigger } from "@ui-sdk/react/menu"
import { chosenItem } from "@/lib/chosen-item"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import { Lcd } from "@/components/ui/lcd"
import { FACTORY_PRESETS } from "./presets"
import { loadPresetById, PRESETS_BY_CATEGORY, stepPreset, usePatchStatus } from "./preset-state"

/**
 * The patch readout: a small LCD with the patch name ("*" once edited since it
 * was loaded) between prev/next keys, and a list key that opens the bank.
 */
export function PresetBrowser() {
  const { name, modified, index } = usePatchStatus()
  const slot = index < 0 ? "--" : String(index + 1).padStart(2, "0")
  return (
    <div data-osc-presets role="group" aria-label="Presets">
      <Button aria-label="Previous preset" onClick={() => stepPreset(-1)}>
        <Icon name="prev" />
      </Button>
      <Lcd size="sm" data-osc-preset-lcd role="status" aria-label={`Patch ${name}${modified ? ", modified" : ""}`}>
        <span data-osc-preset-slot>{slot}</span>
        <span data-osc-preset-name>
          {name}
          {modified && <b data-osc-modified>*</b>}
        </span>
      </Lcd>
      <Button aria-label="Next preset" onClick={() => stepPreset(1)}>
        <Icon name="next" />
      </Button>
      <Menu onAction={(value) => loadPresetById(String(value))}>
        <MenuTrigger data-kit="button" data-tone="secondary" aria-label="Preset list">
          <Icon name="chevron-down" />
        </MenuTrigger>
        <MenuContent data-kit="popup" data-osc-preset-list align="end" sideOffset={10}>
          {PRESETS_BY_CATEGORY.map((group) => (
            <MenuGroup key={group.category}>
              <MenuGroupLabel data-osc-menu-group>{group.label}</MenuGroupLabel>
              {group.presets.map((preset) => (
                <MenuItem key={preset.id} value={preset.id} data-kit="option" data-current={FACTORY_PRESETS[index]?.id === preset.id || undefined} {...chosenItem}>
                  {preset.name}
                </MenuItem>
              ))}
            </MenuGroup>
          ))}
        </MenuContent>
      </Menu>
    </div>
  )
}
