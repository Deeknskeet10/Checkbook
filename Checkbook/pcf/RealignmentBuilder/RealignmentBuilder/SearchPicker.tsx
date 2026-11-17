import * as React from "react";
import { Combobox, Option } from "@fluentui/react-components";

/** Max options rendered per search; the user narrows further by typing. */
export const SEARCH_PAGE = 50;

export interface PickerOpt {
  id: string;
  name: string;
}

interface SearchPickerProps<T extends PickerOpt> {
  placeholder?: string;
  disabled?: boolean;
  /** The currently selected option (null when nothing is picked). */
  selected: T | null;
  /**
   * Returns up to SEARCH_PAGE matches for the typed text ("" = first page). Must be
   * memoized (useCallback): a new function identity re-runs the search while open.
   */
  search: (query: string) => Promise<T[]>;
  /** Text shown in the dropdown row; defaults to the option's name. */
  optionLabel?: (o: T) => string;
  onSelect: (o: T) => void;
}

/**
 * Type-ahead picker for lists too large to preload (thousands of Prioritizations /
 * Requirement Fundings per fiscal year). Typing runs a debounced server-side search
 * instead of filtering a preloaded list; the dropdown only ever holds one page.
 */
export function SearchPicker<T extends PickerOpt>({
  placeholder,
  disabled,
  selected,
  search,
  optionLabel,
  onSelect,
}: SearchPickerProps<T>): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState(selected?.name ?? "");
  // True once the user has typed; until then the box shows the selection and opening
  // lists the first page rather than searching for the selected name.
  const [dirty, setDirty] = React.useState(false);
  const [results, setResults] = React.useState<T[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  // Keep the box in step with the selection (initial load, Edit pre-fill, picking).
  React.useEffect(() => {
    if (!dirty) setText(selected?.name ?? "");
  }, [selected?.id, selected?.name, dirty]);

  const query = dirty ? text.trim() : "";
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setBusy(true);
    const timer = window.setTimeout(
      () => {
        void (async () => {
          try {
            const r = await search(query);
            if (cancelled) return;
            setResults(r);
            setFailed(false);
          } catch {
            if (!cancelled) setFailed(true);
          } finally {
            if (!cancelled) setBusy(false);
          }
        })();
      },
      query ? 250 : 0
    );
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, query, search]);

  const hint = failed
    ? "Search failed — try again"
    : busy
    ? "Searching…"
    : results.length === 0
    ? "No matches"
    : results.length >= SEARCH_PAGE
    ? `Showing the first ${SEARCH_PAGE} — keep typing to narrow`
    : "";

  return (
    <Combobox
      placeholder={placeholder}
      disabled={disabled}
      value={text}
      selectedOptions={selected ? [selected.id] : []}
      onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
        setText(e.target.value);
        setDirty(true);
        setOpen(true);
      }}
      onOpenChange={(_, d) => {
        setOpen(d.open);
        if (!d.open) setDirty(false);
      }}
      onOptionSelect={(_, d) => {
        const picked = results.find((o) => o.id === d.optionValue);
        setDirty(false);
        if (picked) onSelect(picked);
      }}
    >
      {results.map((o) => (
        <Option key={o.id} value={o.id} text={o.name}>
          {optionLabel ? optionLabel(o) : o.name}
        </Option>
      ))}
      {hint && (
        <Option key="__hint" value="__hint" text={hint} disabled>
          {hint}
        </Option>
      )}
    </Combobox>
  );
}
