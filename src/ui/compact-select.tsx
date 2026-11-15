import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ui-sdk/react/select"
import { Icon } from "@/components/ui/icon"

/**
 * A small select in the kit's select-trigger and popup markup, sized for a
 * module row: an LFO division, a route's aux source. Items go on the root too,
 * so the UI SDK agent can read the choices while it's closed.
 */
export function CompactSelect<T extends string>({
  label,
  value,
  options,
  onValueChange,
  param,
}: {
  label: string
  value: T
  options: readonly { value: T; label: string }[]
  onValueChange: (value: T) => void
  param?: string
}) {
  return (
    <div data-osc-select data-param={param}>
      <Select<T> items={[...options]} value={value} onValueChange={(next) => next !== null && onValueChange(next as T)}>
        <SelectTrigger data-kit="select-trigger" aria-label={label}>
          <SelectValue />
          <Icon name="chevron-down" />
        </SelectTrigger>
        <SelectContent data-kit="popup" data-osc-select-popup sideOffset={4}>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value} data-kit="option">
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
