import * as React from "react";
import { Dropdown, Option } from "@fluentui/react-components";
import { LISTBOX_STYLE, type PickerOpt } from "./SearchPicker";

interface ListDropdownProps<T extends PickerOpt> {
  placeholder?: string;
  disabled?: boolean;
  /** Text shown while the options load. */
  busy?: boolean;
  options: T[];
  /** The current selection. May be absent from `options` (e.g. a saved record); it is still shown. */
  selected: T | null;
  /** Row text; defaults to the option's name. */
  optionLabel?: (o: T) => string;
  /** Extra disabled row under the options (e.g. "showing the first 100"). */
  hint?: string;
  onSelect: (o: T) => void;
}

/** Plain dropdown over an already-loaded option list (no typing, unlike SearchPicker). */
export function ListDropdown<T extends PickerOpt>({
  placeholder,
  disabled,
  busy,
  options,
  selected,
  optionLabel,
  hint,
  onSelect,
}: ListDropdownProps<T>): React.ReactElement {
  const note = busy ? "Loading…" : options.length === 0 ? "No matches" : hint ?? "";
  return (
    <Dropdown
      placeholder={placeholder}
      disabled={disabled}
      listbox={{ style: LISTBOX_STYLE }}
      value={selected?.name ?? ""}
      selectedOptions={selected ? [selected.id] : []}
      onOptionSelect={(_, d) => {
        const picked = options.find((o) => o.id === d.optionValue);
        if (picked) onSelect(picked);
      }}
    >
      {options.map((o) => (
        <Option key={o.id} value={o.id} text={o.name}>
          {optionLabel ? optionLabel(o) : o.name}
        </Option>
      ))}
      {note && (
        <Option key="__note" value="__note" text={note} disabled>
          {note}
        </Option>
      )}
    </Dropdown>
  );
}
