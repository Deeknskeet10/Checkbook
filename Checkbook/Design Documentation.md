# Checkbook Design Documentation

The design standard for every **PCF component** (`pcf/`) and **HTML Web
Resource** (`src/ARNGCheckbook/WebResources/`, `webresources/`) in ARNG
Checkbook. All new components, and any existing ones being restyled, follow
this document.

| | |
|---|---|
| **Baseline component** | Itemized Details Grid: [pcf/ItemizedDetailsGrid/ItemizedDetailsGrid/components/ItemizedDetailsGridApp.tsx](pcf/ItemizedDetailsGrid/ItemizedDetailsGrid/components/ItemizedDetailsGridApp.tsx) |
| **Visual + code reference** | [Design/checkbook-design-system.html](Design/checkbook-design-system.html): 8.5in, printable to PDF, has live samples, the HTML CSS kit, and the raw SVG icon library |
| **UI framework (PCF)** | Fluent UI v9 (`@fluentui/react-components`), `checkbookTheme` (= `webLightTheme` with brand `#2086ff`, §2), `makeStyles` |
| **UI framework (HTML)** | Plain HTML/CSS using the `checkbook-kit` style block from the reference HTML |
| **Version** | 1.5 (November 2026): three-tier tags (chip / status label / badge), no table legend, borderless numeric box at rest. 1.4: numeric box (grey fill, bold `$` / `#` prefix), Quantity subtype. 1.3: spacious tables, 11px bold uppercase headers, status pills. 1.2: money / currency inputs (§6.2). 1.1: brand blue `#2086ff`, checkbox / radio / switch restyled |

> **About the `Design/` folder**
> - `checkbook-design-system.html` is the **Checkbook** reference. Open it in a
>   browser, then use **Print / Save as PDF** (Letter) to get a handout.
> - `gaps-style-demo.html` comes from a different product. It is kept **only as
>   a format example** (one printable page that showcases each element). Do
>   **not** use its colors, fonts, or components in Checkbook.

When this document and the HTML reference disagree, **this document wins**. Fix
the HTML in the same change.

---

## 1. Principles

1. **Quiet chrome, loud data.** Borderless buttons, soft input fills, and muted
   context text. The figures and the user's edits are what stand out.
2. **Color carries meaning, never decoration.** Green = add/success, red =
   delete/error, blue = brand/interactive, grey = neutral. A color is never
   reused for a different meaning.
3. **Affordance on hover.** Inputs rest at a grey fill and turn white with a
   blue border on hover. Buttons gain a background only on hover.
4. **State without layout shift.** Sticky header and totals stay put, disabled
   controls keep their size, and an action badge appears inline after the item
   name, in a cell that already wraps. Nothing jitters while a user works.
5. **Disabled = desaturated.** A disabled control keeps its color identity at
   0 saturation and 70% opacity, so users still recognize it.
6. **Tokens over hex.** PCF uses Fluent `tokens.*`. HTML uses `--cb-*`
   variables. A hex literal not listed in §2 is a review flag.

---

## 2. Color tokens

Use the **Fluent token** in PCF and the **CSS variable** in HTML. If a value
has no Fluent token, the literal is approved as-is. Keep these literals in a
shared `const` (see §9) instead of repeating them inline.

### Text & surfaces

| Role | CSS variable | Fluent v9 (PCF) | Value |
|---|---|---|---|
| Text | `--cb-text` | `tokens.colorNeutralForeground1` | `#242424` |
| Text secondary | `--cb-text-secondary` | `tokens.colorNeutralForeground2` | `#424242` |
| Text muted (context, meta, empty) | `--cb-text-muted` | `tokens.colorNeutralForeground3` | `#616161` |
| Surface / sticky header | `--cb-surface` | `tokens.colorNeutralBackground1` | `#ffffff` |
| Surface alt / totals row | `--cb-surface-alt` | `tokens.colorNeutralBackground2` | `#fafafa` |
| Row hover | `--cb-row-hover` | literal | `#fbfbfb` |
| Input resting fill | `--cb-input-fill` | literal | `#f7f7f7` |
| Button hover / pressed | `--cb-hover` / `--cb-pressed` | `colorSubtleBackgroundHover` / `…Pressed` | `#f5f5f5` / `#e0e0e0` |
| Divider / strong border | `--cb-border` / `--cb-border-strong` | `colorNeutralStroke2` / `colorNeutralStroke1` | `#e0e0e0` / `#d1d1d1` |
| Input hover border (2px) | `--cb-input-hover` | literal | `#b2c3f4` |
| Brand / focus | `--cb-brand` | `tokens.colorBrandBackground` (via `checkbookTheme`) | `#2086ff` |
| Brand hover / pressed | `--cb-brand-hover` / `--cb-brand-pressed` | `colorBrandBackgroundHover` / `…Pressed` | `#1a74e0` / `#1560bd` |

### Action & semantic

| Role | CSS variable | Fluent v9 (PCF) | Value |
|---|---|---|---|
| Add icon | `--cb-add` | literal | `#16ca92` |
| Delete icon + destructive label | `--cb-danger` | literal | `#9f151e` |
| Neutral icon (Refresh, Edit, Close…) | `--cb-icon-neutral` | literal | `#727272` |
| In-field icon (Search) | `--cb-icon-subtle` | literal | `#989898` |
| Load more / hover | `--cb-link` / `--cb-link-hover` | literal | `#5b9bd5` / `#2e5f8a` |
| Success text | `--cb-success-text` | `tokens.colorPaletteGreenForeground1` | `#0e700e` |
| Invalid-input border | `--cb-error` | literal | `#d13438` |
| Inline error text | `--cb-error-text` | `tokens.colorPaletteRedForeground1` | `#bc2f32` |
| Error / warning banner bg | `--cb-error-tint` / `--cb-warn-tint` | `colorPaletteRedBackground1` / literal | `#fdf3f4` / `#fff9e6` |

### Choice controls (checkbox / radio / switch)

| Role | CSS variable | PCF | Value |
|---|---|---|---|
| Checked fill, radio ring/dot, switch on, hover label | `--cb-brand` | `colorCompoundBrand*` (via `checkbookTheme`) | `#2086ff` |
| Unchecked checkbox / radio border | `--cb-control-line` | `CB.controlLine` | `#d9d9d9` |
| Control row hover background | `--cb-control-hover-bg` | `CB.controlHoverBg` | `#f1f6ff` |

### Tags: chip, status label, badge (§8)

| Role | CSS variable | PCF | Value |
|---|---|---|---|
| Chip border | `--cb-chip-line` | `CB.chipLine` | `#d1d5db` |
| Chip label / value | `--cb-chip-label` / `--cb-chip-value` | `CB.chipLabel` / `CB.chipValue` | `#4b5563` (7.6:1) / `#111827` (17.7:1) |
| `+N` border / text | `--cb-chip-more-line` / `--cb-chip-more-text` | `CB.chipMoreLine` / `CB.chipMoreText` | `#6b7280` / `#374151` (10.3:1) |
| Chip dot hues, in order | `--cb-hue-category` · `-qtytype` · `-class` · `-origin` · `-phase` · `-priority` · `-fundingmode` · `-lin` · `-country` | `CHIP_HUES` map | `#16a34a` · `#2563eb` · `#7c3aed` · `#d97706` · `#0d9488` · `#db2777` · `#4f46e5` · `#0891b2` · `#65a30d` |
| Saved / Error badge | `--cb-badge-saved` / `--cb-badge-error` | `CB.badgeSaved` / `CB.badgeError` | `#15803d` (5.0:1) / `#b91c1c` (6.5:1), white text |
| Label / hyperlink label fill, hover | `--cb-label-bg` / `--cb-label-bg-hover` | `CB.labelBg` / `CB.labelBgHover` | `#e8f2ff` / `#d3e6ff`, text `CB.brandPressed` `#1560bd` |
| Status success | `--cb-status-success-bg` / `-fg` | `STATUS.success` | `#e2fcdc` / `#14532d` (8.3:1) |
| Status warning | `--cb-status-warning-bg` / `-fg` | `STATUS.warning` | `#fef3c7` / `#78350f` (8.2:1) |
| Status danger | `--cb-status-danger-bg` / `-fg` | `STATUS.danger` | `#fee2e2` / `#7f1d1d` (8.2:1) |
| Status info | `--cb-status-info-bg` / `-fg` | `STATUS.info` | `#dbeafe` / `#1e3a8a` (8.5:1) |
| Status neutral | `--cb-status-neutral-bg` / `-fg` | `STATUS.neutral` | `#f3f4f6` / `#374151` (9.4:1) |

Every text color passes 4.5:1 on its fill. **Do not lighten any of them.**

### Numeric box (money / quantity)

| Role | CSS variable | PCF | Value |
|---|---|---|---|
| Box border | n/a | n/a | `transparent` at rest. Hover `#b2c3f4`, focus `#2086ff` |
| `$` / `#` prefix (bold) | `--cb-adornment` | `CB.adornment` | `#5c5875` (6.3:1 on the grey fill) |
| Focus halo | `--cb-focus-ring` | `CB.focusRing` | `rgba(32,134,255,.18)` |
| Invalid border / halo | `--cb-error` / `--cb-error-ring` | `CB.error` / `CB.errorRing` | `#d13438` / `rgba(209,52,56,.15)` |

### Table

| Role | CSS variable | PCF | Value |
|---|---|---|---|
| Header band | `--cb-table-head` | `CB.tableHead` | `#f7f7f7` |
| Row divider | `--cb-row-line` | `CB.rowLine` | `#f0f0f0` |
| Selected row | `--cb-row-selected` | `CB.rowSelected` | `#f5f9ff` |
| Idle sort chevrons | `--cb-sort-idle` | `CB.sortIdle` | `#8a8a8a` (3.2:1 on the header band) |
| Standard switch, false | `--cb-switch-off` | `CB.switchOff` | `#c8c8c8` |
| `goodbad` switch, true | `--cb-switch-good` | `CB.switchGood` | `#22b35e` |
| `goodbad` switch, false | `--cb-switch-bad` | `CB.switchBad` | `#e5484d` |

### Brand theme (PCF)

Fluent's `webLightTheme` brand is `#0f6cbd`. Every PCF wraps its UI in
`<FluentProvider theme={checkbookTheme}>` so primary buttons, focus, links and
checked controls pick up the softer `#2086ff`:

```tsx
import { webLightTheme, Theme } from "@fluentui/react-components";

const BRAND = "#2086ff", BRAND_HOVER = "#1a74e0", BRAND_PRESSED = "#1560bd";

export const checkbookTheme: Theme = {
  ...webLightTheme,
  colorBrandBackground: BRAND,
  colorBrandBackgroundHover: BRAND_HOVER,
  colorBrandBackgroundPressed: BRAND_PRESSED,
  colorBrandBackgroundSelected: BRAND_HOVER,
  colorBrandForeground1: BRAND,
  colorBrandForeground2: BRAND_HOVER,
  colorBrandForegroundLink: BRAND,
  colorBrandForegroundLinkHover: BRAND_HOVER,
  colorBrandForegroundLinkPressed: BRAND_PRESSED,
  colorBrandStroke1: BRAND,
  colorBrandBackground2: "#e8f2ff",
  colorBrandBackground2Pressed: "#b3d4ff",
  // Checkbox, Radio and Switch read the "compound brand" tokens
  colorCompoundBrandBackground: BRAND,
  colorCompoundBrandBackgroundHover: BRAND_HOVER,
  colorCompoundBrandBackgroundPressed: BRAND_PRESSED,
  colorCompoundBrandStroke: BRAND,
  colorCompoundBrandStrokeHover: BRAND_HOVER,
  colorCompoundBrandStrokePressed: BRAND_PRESSED,
  colorCompoundBrandForeground1: BRAND,
  colorCompoundBrandForeground1Hover: BRAND_HOVER,
  colorCompoundBrandForeground1Pressed: BRAND_PRESSED,
};
```

> **Contrast:** white 14px text on `#2086ff` is about **3.4:1**. That is below
> WCAG AA's 4.5:1 for normal text, but above the 3:1 required for UI parts
> (checkbox fills, switch tracks, borders). Keep primary-button labels
> semibold (600). Don't use `#2086ff` for long runs of body text.

**Retire these:** Fluent **v8** hex values are hardcoded across many current
PCFs and `book_stateSpendPlan.html`: `#605e5c`, `#323130`, `#a19f9d`,
`#edebe9`, `#f3f2f1`, `#a4262c`, `#0078d4`. Replace them with the v9 tokens
above when you next touch those files.

---

## 3. Typography

- **Family:** Segoe UI stack (`tokens.fontFamilyBase`). No other font — except
  the *proposed* abbreviated-money and summary-card text below, which uses
  `sans-serif`.
- **Sizes:** 10.5px action badges, **11px table headers**, 12px meta, chips and `+N`
  (`fontSizeBase200`), 13px status labels, **14px** body, cells and buttons (`fontSizeBase300`),
  20px dialog title.
- **Weight:** 400 normal (chip labels), **600** for emphasis (titles, totals,
  item names, chip values, status labels). **700 in only three places**: table
  headers (11px / 700 / UPPERCASE / `.05em`), action badges (10.5px / 700 /
  UPPERCASE / `.05em`) and the `$` / `#` prefix of numeric boxes (§6.2).
  Never 700+ anywhere else.
- **Numbers:** `fontVariantNumeric: "tabular-nums"`, right-aligned, currency
  via `value.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 })`.
- **Copy:** Title Case for buttons and headers (*Add Items*, *Delete Selected*),
  sentence case for messages, counts in parentheses (*Itemized Details (24)*),
  and loading text ending in an ellipsis (*Loading Itemized Details…*).

### Abbreviated money & summary cards *(proposed — experimental)*

> **Status: documented only.** No PCF component implements this yet; do not
> add it to a control until it is promoted out of "proposed". It is being
> trialled for readability on large amounts (e.g. a $1,667,707.16 total).

**Money abbreviation.** Large amounts are shortened with a unit suffix:

| Suffix | Unit | Example |
|---|---|---|
| `T` | trillions (≥ 1,000,000,000,000) | `$1.25T` |
| `B` | billions (≥ 1,000,000,000) | `$2.40B` |
| `M` | millions (≥ 1,000,000) | `$1.67M` |
| `K` | thousands (≥ 1,000) | `$850.00K` |

- Abbreviated money text: **16px**, `font-family: sans-serif` (not monospace).
  Weight is inherited from its context (e.g. 600 in a totals row).
- Examples above show two decimals, taken from the mock-ups (`$850.00K`,
  `$1.67M`). The exact rounding rule, the sub-1,000 behaviour and negative
  values are **not yet decided**.
- The abbreviation is a reading aid, not the value: show the full amount
  (`$1,667,707.16`) alongside it, as in the card below.

**Summary card text.** Three styles for a cost summary card (e.g. *Withhold
(Available)* with `$850.00K` over `$850,000.00`):

| Part | Font size | Weight | Other |
|---|---|---|---|
| **Card title** | `var(--fontSizeBase200)` (12px) | 600 | `opacity: 0.8` |
| **Big money** (abbreviated) | 28px | 600 | `font-family: sans-serif` |
| **Small money** (full amount) | 16px | 400 | — |

The cards keep the tinted fills of the existing stat cards (success / danger,
§8 colors). Since the text color on a tinted card is the dark shade of its
hue, the title's `opacity: 0.8` softens it without introducing a new color.

## 4. Spacing & shape

Scale: **2 · 4 · 6 · 8 · 10 · 12 · 16 · 24 px**.

| Where | Value |
|---|---|
| Component root | `padding: 8px` |
| Toolbar | `padding: 4px 2px 8px 2px`, button gap `8px`, title-group gap `10px` |
| Table cell | `padding: 12px 16px`, min row height `56px`, `max-width: 220px`. Header band `40px`, `padding: 0 16px`. Compact (dialogs only): `8px 12px`, `44px` rows |
| Empty state | `padding: 16px` |
| Radius | `4px` controls and badges · `6px` chips, `+N` and numeric boxes · `8px` dialogs · full pill for status labels · `50%` dots |
| Icons | `20px` in buttons (Refresh `18px`) · `16px` in search fields |

---

## 5. Buttons

**The default button has no border, a transparent background, a hover
background, and an icon.** In Fluent this is
`<Button appearance="subtle" size="small" icon={<XIcon />}>`.

| Variant | Use for | Spec |
|---|---|---|
| **Action** (default) | Toolbar commands | `subtle`, 14px `#242424` label, `padding: 10px 14px`, colored icon before the label |
| **Destructive** | Delete / Remove / Clear | Action spec with the label in `#9f151e` and a red trash icon. **Always** confirm in a dialog. |
| **Icon-only** | Row actions, close, inline edit | `subtle`, no label, **required** `aria-label` + `<Tooltip relationship="label">` (HTML: `title` + `aria-label`) |
| **Primary** | Dialog confirm **only** | `appearance="primary"`, one per dialog, rightmost |
| **Secondary** | Dialog cancel/back **only** | `appearance="secondary"`, left of primary |
| **Load more** | Grid paging row | Full width, 40px, 600 weight 15px `#5b9bd5` → `#2e5f8a` on hover |

**Disabled (all variants):** `opacity: 0.7; filter: saturate(0); cursor: not-allowed`.
Do **not** swap the color. The `filter` also greys out the icon's hard-coded
SVG fill, which a `color` change cannot reach.

Primary and secondary (filled or bordered) buttons appear **only** in dialog
footers. Everywhere else, use subtle buttons.

```tsx
// Shared button styles (pcf/<Control>/…/styles or the shared module in §9)
toolbarButton: {
  fontSize: "14px",
  color: tokens.colorNeutralForeground1,
  padding: "10px 14px",
  ":disabled": { opacity: 0.7, filter: "saturate(0)", cursor: "not-allowed" },
},
destructiveButton: {
  fontSize: "14px",
  padding: "10px 14px",
  color: CB.danger,                          // #9f151e
  ":disabled": { opacity: 0.7, filter: "saturate(0)", cursor: "not-allowed" },
},
```

```tsx
// Labeled action
<Button size="small" appearance="subtle" className={styles.toolbarButton}
        icon={<AddIcon />} disabled={dataset.loading} onClick={openAddDialog}>
  Add Items
</Button>

// Icon-only: tooltip + aria-label are mandatory
<Tooltip content="Delete Itemized Detail" relationship="label">
  <Button size="small" appearance="subtle" icon={<DeleteIcon />}
          aria-label="Delete Itemized Detail" onClick={() => setPendingRemove(row)} />
</Tooltip>
```

---

## 6. Inputs

| Rule | Spec |
|---|---|
| **Editable** | Fluent `appearance="filled-lighter"`, `backgroundColor: "#f7f7f7"`, `border: "2px solid transparent"`. On `:hover`, `#fff` background + `2px solid #b2c3f4` border (`!important` is needed to beat Fluent's own hover rule). |
| **Numbers** (other numerics: percent, rank, year) | **Money and quantity use the numeric box in §6.2 instead.** `type="number"`, right-aligned and tabular via the `input` slot, spin buttons hidden (`MozAppearance: "textfield"` + `::-webkit-*-spin-button { WebkitAppearance: none }`) |
| **Read-only** | No fill, no hover border, `cursor: default`, `tabIndex={-1}`. Long text uses a `readOnly` Textarea so it wraps and scrolls. |
| **Control locked** (`isDisabled`) | Render values as **plain muted text**, not disabled inputs |
| **Saving** | Commit on `onBlur` / `onOptionSelect`, never per keystroke |
| **Long reference lists** | `Combobox` (type-to-filter). Cap the listbox at `maxHeight: 200px`, `overflowY: auto`, and let option text wrap. |
| **Search** | `appearance="outline"`, `size="small"`, `contentBefore={<SearchIcon />}`, placeholder lists the searchable fields ("Search Item, Fund Center, Country, LIN") |
| **Widths** | Qty 80px · Amount 100px · Dropdown 100–160px (height 30px) · Comment 150–200px · Toolbar search 180–400px |

```tsx
editableField: {
  backgroundColor: CB.inputFill,             // #f7f7f7
  border: "2px solid transparent",
  ":hover": { backgroundColor: "#fff", border: `2px solid ${CB.inputHover} !important` },
},
```

### 6.1 Checkbox, radio & switch

Light grey outline at rest, solid `#2086ff` when on. **On hover, the row gets
a soft `#f1f6ff` background and the label text turns blue**, and an unchecked
checkbox/radio outline turns blue too. See
the live samples in [the HTML reference §6](Design/checkbook-design-system.html).

| Control | Spec |
|---|---|
| **Checkbox** | 18px square, radius `4px`, 1.5px `#d9d9d9` border on white. Checked = `#2086ff` fill + white check. Mixed (select-all) = blue fill + white dash. |
| **Radio** | 18px circle, 1.5px `#d9d9d9` border. Checked = 2px `#2086ff` ring + 11px blue dot. Groups stack vertically, 10px apart. |
| **Switch: standard** (no class) | 40×24 pill, 18px white knob inset 3px, with a soft shadow. **True = blue `#2086ff`, false = gray `#c8c8c8`.** |
| **Switch: `goodbad`** | Same shape. **True = green `#22b35e`, false = red `#e5484d`.** Use only when *both* states mean something (Valid / Invalid, Funded / Unfunded). Plain on/off settings use standard. |
| **Hover** | The whole row gets a `#f1f6ff` background, the label turns `#2086ff`, and an unchecked checkbox/radio border turns `#2086ff`. No hover effect when disabled. |
| **Label / row** | 14px `#242424`, 10px gap after the control. The row has `5px` padding and a `5px` radius, so the hover background frames control + label. Always give a visible label, or an `aria-label` inside grid cells. |
| **Disabled** | Same as buttons: `opacity: .7; filter: saturate(0)`, `cursor: not-allowed`. |
| **Switch vs checkbox** | A switch takes effect immediately (it saves on toggle). A checkbox is a selection or a form value that is saved later. |

**PCF:** Fluent's `Checkbox`, `Radio` and `Switch`, with `checkbookTheme` for
the blue plus these slot styles. They override Fluent's grey resting colors,
so they need `!important` in a few places.

```tsx
// Shared row: 5px padding, 5px radius, #f1f6ff on hover (none when disabled)
const choiceRow = {
  padding: "5px",
  borderRadius: "5px",
  transitionProperty: "background-color",
  transitionDuration: "120ms",
  ":hover": { backgroundColor: CB.controlHoverBg },
  ":has(input:disabled):hover": { backgroundColor: "transparent" },
} as const;

export const useChoiceStyles = makeStyles({
  // Root classes: row tints, label turns blue on hover, unchecked outline turns blue
  checkbox: {
    ...choiceRow,
    ":hover .fui-Checkbox__label": { color: CB.brand },
    ":hover .fui-Checkbox__input:enabled:not(:checked) ~ .fui-Checkbox__indicator": {
      borderColor: `${CB.brand} !important`,
    },
  },
  radio: {
    ...choiceRow,
    ":hover .fui-Radio__label": { color: CB.brand },
    ":hover .fui-Radio__input:enabled:not(:checked) ~ .fui-Radio__indicator": {
      borderColor: `${CB.brand} !important`,
    },
  },
  switch: { ...choiceRow, ":hover .fui-Switch__label": { color: CB.brand } },

  // Indicator slots
  checkboxBox: { width: "18px", height: "18px", borderRadius: "4px", border: `1.5px solid ${CB.controlLine}` },
  radioRing:   { width: "18px", height: "18px", border: `1.5px solid ${CB.controlLine}` },
  switchTrack: {
    width: "40px", height: "24px", border: "none !important",
    backgroundColor: CB.switchOff,          // false; Fluent's :checked rule applies the brand blue
    color: "#fff !important",               // knob
    padding: "0 3px",                       // knob inset 3px
    "& svg": { fontSize: "18px", width: "18px", height: "18px", filter: "drop-shadow(0 1px 2px rgba(0,0,0,.3))" },
  },

  // Switch subclass: true = green, false = red
  goodbad: {
    "& .fui-Switch__input ~ .fui-Switch__indicator": { backgroundColor: `${CB.switchBad} !important` },
    "& .fui-Switch__input:checked ~ .fui-Switch__indicator": { backgroundColor: `${CB.switchGood} !important` },
  },
});
```

```tsx
const c = useChoiceStyles();

<Checkbox label="Carbonara" className={c.checkbox} indicator={{ className: c.checkboxBox }} />

<RadioGroup value={fruit} onChange={(_, d) => setFruit(d.value)}>
  <Radio value="apple" label="Apple" className={c.radio} indicator={{ className: c.radioRing }} />
</RadioGroup>

<Switch label="Active" className={c.switch} indicator={{ className: c.switchTrack }} />                      {/* standard */}
<Switch label="Valid"  className={mergeClasses(c.switch, c.goodbad)} indicator={{ className: c.switchTrack }} /> {/* goodbad */}
```

**HTML:** wrap the input in its label so the whole row is hoverable and clickable:

```html
<label class="cb-checkbox"><input type="checkbox"><span>Carbonara</span></label>
<label class="cb-radio"><input type="radio" name="fruit" checked><span>Apple</span></label>
<label class="cb-switch"><input type="checkbox" role="switch" checked><span>Active</span></label>
<label class="cb-switch goodbad"><input type="checkbox" role="switch"><span>Valid</span></label>
```

### 6.2 Numeric inputs: Money (`$`) and Quantity (`#`)

Two subtypes of numeric input share one look and one behavior. In Dataverse
both are usually **Double** columns that store a plain number. The symbol is
part of the *box*, never part of the value.

| Subtype | Use for | Prefix |
|---|---|---|
| **Money** | any column the form calls Money, Currency or an amount (Requested, Validated, Funded, Obligated…). Checkbook only deals in US dollars. | `$` |
| **Quantity** | any count of items (Quantity, Qty Requested, # of Personnel…) | `#` |

See the live states in [the HTML reference, *Money & quantity*](Design/checkbook-design-system.html).

**The box** (both subtypes)

| Part | Spec |
|---|---|
| Box | 32px tall, **grey `#f7f7f7` fill** and **no visible border at rest** (1px transparent, so nothing shifts), the same as other editable inputs, **6px radius**, `0 10px` padding, 8px gap |
| Prefix | On the **left**. 14px, **bold (700)**, `#5c5875` (`--cb-adornment`), not selectable. Clicking it focuses the input. |
| Value | 14px `#242424`, **right-aligned**, `tabular-nums` |
| Hover | Fill turns white, border `#b2c3f4` |
| Focus | Fill white, border `#2086ff` + 3px halo `rgba(32,134,255,.18)` |
| Invalid | Border `#d13438` + 3px red halo until the next focus. PCF also sets the row **Error** badge (§8). |
| Disabled | `opacity: .7; filter: saturate(0)`, `#fafafa` fill |
| Width | Money 120–140px · Quantity 88–110px |

**Behavior**

| State | Money `$` | Quantity `#` |
|---|---|---|
| **Unfocused** | `1,250.50`: always 2 decimals, comma separators, negatives `-4,800.00` | `1,200`: comma separators, no forced decimals |
| **Focused** | Raw `1250.50` (or `1250`), **all text selected** for fast overwrite | Raw `1200`, all text selected |
| **Empty** | Muted `0.00` placeholder. Saves *null*, never 0. | Muted `0` placeholder. Saves null. |
| **Allowed** | Any number, rounded to cents | ≥ 0. Whole numbers unless the column allows decimals (`decimals` prop / `data-decimals`). Extra decimals are **invalid**, not rounded. |
| **Typing** | Only digits, `.` and `-` are kept. A pasted `$2,000` becomes `2000`. | Same |
| **Commit** | Blur or **Enter**, only if the number changed. **Esc** reverts. | Same |
| **Input type** | `type="text" inputMode="decimal"` | `type="text" inputMode="numeric"` (`decimal` if decimals allowed) |
| **Read-only / locked** | Plain text **`$1,250.50`**: the `$` joins the text, with no box | Plain text `1,200` |

`type="number"` is **not** used for either subtype. It can't show separators,
and `select()` doesn't work on it.

**PCF:** one shared `NumericInput` in `designSystem.tsx`, plus thin
`MoneyInput` / `QuantityInput` wrappers:

```tsx
type NumericKind = "money" | "quantity";

const fmt = new Map<string, Intl.NumberFormat>();
const nf = (min: number, max: number) => {
  const k = `${min}:${max}`;
  if (!fmt.has(k)) fmt.set(k, new Intl.NumberFormat("en-US", { minimumFractionDigits: min, maximumFractionDigits: max }));
  return fmt.get(k)!;
};
const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "$1,250.50": read-only text and totals (no box). */
export const formatMoney = (n: number | null) => (n === null ? "" : USD.format(n));
/** Unfocused text inside the box: "1,250.50" / "1,200". */
export const formatInBox = (kind: NumericKind, n: number | null, decimals: number) =>
  n === null ? "" : nf(kind === "money" ? 2 : 0, decimals).format(n);
/** Focused text: "1250.50" / "1200". */
export const rawNumber = (kind: NumericKind, n: number | null) =>
  n === null ? "" : kind === "money" && !Number.isInteger(n) ? n.toFixed(2) : String(n);
/** null = empty, NaN = invalid. */
export const parseNumber = (kind: NumericKind, text: string, decimals: number): number | null => {
  const c = text.replace(/[^0-9.\-]/g, "");
  if (c === "") return null;
  const n = Number(c);
  if (!Number.isFinite(n)) return NaN;
  const f = 10 ** decimals;
  if (kind === "quantity") return n < 0 || Math.round(n * f) / f !== n ? NaN : n; // reject, don't round
  return Math.round(n * f) / f;                                                    // money: round to cents
};

export const useNumericStyles = makeStyles({
  box: {
    backgroundColor: CB.inputFill,                        // #f7f7f7
    border: "1px solid transparent",                     // no border at rest
    borderRadius: "6px",
    minHeight: "32px",
    paddingLeft: "10px", paddingRight: "10px", columnGap: "8px",
    ":hover": { backgroundColor: "#fff", borderColor: `${CB.inputHover} !important` },
    ":focus-within": { backgroundColor: "#fff", borderColor: `${CB.brand} !important`, boxShadow: `0 0 0 3px ${CB.focusRing}` },
    "::after": { display: "none" },                       // hide Fluent's focus underline
    "& input": { textAlign: "right", fontVariantNumeric: "tabular-nums", paddingLeft: 0, paddingRight: 0 },
  },
  invalid: { borderColor: `${CB.error} !important`, boxShadow: `0 0 0 3px ${CB.errorRing}` },
  prefix: { color: CB.adornment, fontSize: "14px", fontWeight: 700, userSelect: "none" },
});

export interface NumericInputProps {
  value: number | null;
  onCommit: (value: number | null) => void;   // only called when the number changed
  onInvalid?: () => void;                     // e.g. set the row's "error" save state
  decimals?: number;                          // quantity only; money is always 2
  disabled?: boolean;
  className?: string;
  live?: boolean;                             // also commit each valid keystroke; Esc restores the focus-time value
  "aria-label"?: string;
}

export const NumericInput: React.FC<NumericInputProps & { kind: NumericKind }> = ({
  kind, value, onCommit, onInvalid, decimals, disabled, className, ...aria
}) => {
  const s = useNumericStyles();
  const dec = kind === "money" ? 2 : decimals ?? 0;
  const [focused, setFocused] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [invalid, setInvalid] = React.useState(false);
  const cancel = React.useRef(false);
  const justFocused = React.useRef(false);

  return (
    <Input
      {...aria}
      type="text"
      inputMode={kind === "money" || dec > 0 ? "decimal" : "numeric"}
      appearance="outline"
      className={mergeClasses(s.box, invalid && s.invalid, className)}
      contentBefore={<span className={s.prefix} aria-hidden="true">{kind === "money" ? "$" : "#"}</span>}
      disabled={disabled}
      placeholder={kind === "money" ? "0.00" : "0"}
      value={focused ? draft : formatInBox(kind, value, dec)}
      onFocus={(e) => {
        const el = e.currentTarget;
        setInvalid(false);
        setDraft(rawNumber(kind, value));
        setFocused(true);
        justFocused.current = true;
        requestAnimationFrame(() => {                    // after the raw value renders;
          if (el.ownerDocument.activeElement === el) el.select(); // select() also focuses, so a fast blur must win
        });
      }}
      onMouseUp={(e) => {                               // keep the click-focus selection
        if (justFocused.current) { e.preventDefault(); justFocused.current = false; }
      }}
      onChange={(_e, d) => setDraft(d.value.replace(/[^0-9.\-]/g, ""))}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") { cancel.current = true; e.currentTarget.blur(); }
      }}
      onBlur={() => {
        setFocused(false);
        justFocused.current = false;
        if (cancel.current) { cancel.current = false; return; }
        const n = parseNumber(kind, draft, dec);
        if (Number.isNaN(n)) { setInvalid(true); onInvalid?.(); return; }
        if (n !== value) onCommit(n);
      }}
    />
  );
};

export const MoneyInput: React.FC<Omit<NumericInputProps, "decimals">> = (p) => <NumericInput kind="money" {...p} />;
export const QuantityInput: React.FC<NumericInputProps> = (p) => <NumericInput kind="quantity" {...p} />;
```

```tsx
// In a grid row
<QuantityInput aria-label="Quantity" className={styles.qtyBox}
  value={row.quantity} onCommit={(v) => commit(row, "quantity", v)}
  onInvalid={() => setSaveState(row.recordId, "error")} />
<MoneyInput aria-label="Requested amount" className={styles.moneyBox}
  value={row.requestedAmount} onCommit={(v) => commit(row, "requestedAmount", v)}
  onInvalid={() => setSaveState(row.recordId, "error")} />

// Read-only and totals: plain text, symbol joins the text
<span className={styles.amountBodyRight}>{formatMoney(row.fundedAmount)}</span>
```

**HTML:** copy the `<script id="checkbook-numeric">` block from the reference
HTML together with the `checkbook-kit` style. It handles focus, blur, Enter,
Esc and paste for every `.cb-money` / `.cb-qty` input, including rows added
later. Use a `<label>` wrapper, so clicking the prefix focuses the input:

```html
<label class="cb-num" style="width:130px">
  <span class="cb-num-adorn" aria-hidden="true">$</span>
  <input class="cb-money" type="text" inputmode="decimal" data-value="1250.5" aria-label="Requested amount">
</label>

<label class="cb-num" style="width:96px">
  <span class="cb-num-adorn" aria-hidden="true">#</span>
  <input class="cb-qty" type="text" inputmode="numeric" data-value="12" aria-label="Quantity">
</label>
<!-- quantity with decimals: data-decimals="2" inputmode="decimal" -->

<script>
  // dataset.value holds the plain number ("" = empty); never read input.value
  el.addEventListener("cb-num-commit", (e) => save(e.detail.value));   // number | null
  el.addEventListener("cb-num-error",  () => flagRow(el));
  cbNum.set(el, 86000);                       // set from code
  cbNum.refresh(tableBody);                   // after building rows
  cell.textContent = cbNum.formatMoney(80000) // read-only: "$80,000.00"
</script>
```

> **`live`:** batch editors whose totals or Save button must track typing (Edit → Save
> grids, dialogs that reconcile sums) pass `live`, so the value commits on every valid
> keystroke instead of on blur. Without it, a Save button that enables on change can
> swallow the first click. Per-row autosave grids leave it off. See PrioritizationFundingGrid.

---

## 7. Data grid

Tables are **spacious by default**: a soft header band, 56px rows, 16px side
padding, and hairline dividers instead of a heavy grid. **Header labels are
always small, bold and uppercase: 11px / 700 / UPPERCASE**, letter-spacing
`.05em`. Write the label in Title Case in code; CSS `text-transform` does the
uppercasing, so screen readers don't spell it out letter by letter.

| Part | Spec |
|---|---|
| **Scroll container** | `width: 100%`, `maxHeight: 560px` (~8 rows), `overflow: auto` (both axes) |
| **Table** | Fluent `<Table size="medium">`, `tableLayout: "auto"` (Fluent defaults to `fixed`, which clips cells) + `minWidth: 760px` |
| **Header** | 40px band, `#f7f7f7`, 8px rounded ends, no bottom border. Label 11px / **700** / UPPERCASE / `.05em`, `#424242`. Sticky `top: 0; zIndex: 2`. |
| **Sortable header** | Double-chevron Sort icon (12px, §10) **always visible** in `#8a8a8a`. The active direction's chevron darkens to `#242424` via `aria-sort`, and the label darkens on hover. Click handler on the header's **`button` slot**. Don't use Fluent's `sortDirection` prop, because it only draws an arrow on the active column. |
| **Numeric columns** | Right-aligned body **and** header (`justifyContent: "end"` on the `button` slot). The sort chevron goes *before* the label. |
| **Row** | Min height **56px**, padding **`12px 16px`**, max-width 220px. Divider 1px `#f0f0f0`. Hover `#fbfbfb`. **Selected** `#f5f9ff` (blue-tinted so `#f7f7f7` inputs stay visible). |
| **Identity (first) column** | Item name (600) with the action **badge** inline right after it, then the **chips** underneath, wrapping onto new lines (§8). Min width **300px**, enough for two chips side by side. This column wraps; other columns are `nowrap`, and context columns are muted. |
| **Status column** | One **status label** per row (§8). It is the column's sort and filter value. |
| **Record links** | `<Link as="button">` + `navigation.openForm(...)` |
| **Selection** | Leading 44px column. The header checkbox is tri-state (`"mixed"`) over **visible** rows. Checked rows get the selected background. Show "● Selected (N)" in the toolbar when N > 0. |
| **Row actions** | Last column, right-aligned, header **Actions**. Icon-only 30px buttons with 16px icons, in the order **Edit · Delete · More (⋯)**. More opens a `Menu` for anything else. Omit the column when read-only. |
| **Load more** | Sticky row `bottom: 52px`, td `padding: 0`, spans all columns. Only shown when `dataset.paging.hasNextPage`. |
| **Totals** | Sticky `bottom: -1px`, **52px** tall, 600 weight, `#fafafa`, 1px `#e0e0e0` top border. Totals must cover **all** records (fetched separately), not just the loaded page. |
| **Compact variant** | 44px rows, `8px 12px` padding, 34px header. **Only** for dialogs and pick-lists, never a main grid. |

```tsx
// Grid styles: spacious defaults
scrollContainer: {
  width: "100%", maxHeight: "560px", overflow: "auto",
  "& th": {
    height: "40px", padding: "0 16px",
    position: "sticky", top: 0, zIndex: 2,
    backgroundColor: CB.tableHead,                     // #f7f7f7
    color: tokens.colorNeutralForeground2,
    fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em",
    borderBottom: "none",
  },
  "& th:first-child": { borderRadius: "8px 0 0 8px" },
  "& th:last-child":  { borderRadius: "0 8px 8px 0" },
  "& td": { height: "56px", padding: "12px 16px", maxWidth: "220px" },
  "& tbody tr": { borderBottom: `1px solid ${CB.rowLine}` },   // #f0f0f0 (Fluent default is darker)
  "& tbody tr:hover": { backgroundColor: CB.rowHover },
},
tableAutoLayout: { tableLayout: "auto", minWidth: "760px" },
rowSelected: { backgroundColor: `${CB.rowSelected} !important` }, // <TableRow aria-selected className=…>
totalsRow: {
  fontWeight: 600,
  "& td": { height: "52px", position: "sticky", bottom: "-1px", zIndex: 2,
            backgroundColor: tokens.colorNeutralBackground2, borderTop: `1px solid ${tokens.colorNeutralStroke2}` },
},
loadMoreRow: { "& td": { position: "sticky", bottom: "52px", zIndex: 2, padding: 0,
                         backgroundColor: tokens.colorNeutralBackground1 } },
sortIdle:   { "& path": { stroke: CB.sortIdle } },        // #8a8a8a
sortAsc:    { "& .up":   { stroke: tokens.colorNeutralForeground1 } },
sortDesc:   { "& .down": { stroke: tokens.colorNeutralForeground1 } },
```

```tsx
// Sortable header: Title Case label, CSS uppercases it; aria-sort drives the chevrons
<TableHeaderCell
  aria-sort={sortField === "item" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}
  button={{ className: styles.sortableHeaderButton, onClick: () => toggleSort("item") }}
>
  Item
  <SortIcon className={mergeClasses(styles.sortIdle,
    sortField === "item" && (sortDirection === "asc" ? styles.sortAsc : styles.sortDesc))} />
</TableHeaderCell>
```

## 8. Tags: chips, status labels, badges · feedback

The items table uses **three kinds of tag, one system**. Each tier has its
own look, so a glance says which kind you're reading. **Never mix the tiers**:
no tinted chips, no outlined statuses, no icons on chips. See them live in
[the HTML reference §8](Design/checkbook-design-system.html).

| Tier | Means | Look | Icon | Where |
|---|---|---|---|---|
| **Chip** | what it *is* | neutral / outlined | **never** (a dot is not an icon) | under the item name. Static, optional, never sortable or clickable |
| **Status label** | where it *stands* | tinted | **always** | its own column. The filter and sort value |
| **Label** | what it *is*, as plain text (e.g. a TDC) | brand-blue tint | **never** | its own column. Static, not clickable |
| **Hyperlink label** | a *link* to a related record | brand-blue tint | **always** (link icon, left) | its own column. Always opens in a **new tab** |
| **Badge** | what just *happened* | solid | **always** | inline after the item name, only while an action result is pending. Clears itself |

### Chip: "Label: Value"

- One chip = one **Label: Value** pair: 24px tall, 6px radius, white fill,
  1px `#d1d5db` border, `0 8px` padding, 12px text, 6px gap.
- Label 400 `#4b5563`. Value **600** `#111827`.
- An **8px dot** before the label is a *scanning aid only*, since the label
  carries the meaning. The dot is `aria-hidden` (HTML: drawn with `::before`).
  Use **one type-to-hue map**, in this order: Category `#16a34a` · Qty Type
  `#2563eb` · Class `#7c3aed` · Origin `#d97706` · Phase `#0d9488` · Priority
  `#db2777` · Funding Mode `#4f46e5` · LIN `#0891b2` · Country `#65a30d`. New
  attribute types get the next hue added to the map, never an ad-hoc color.
- Chips sit under the item name and **wrap onto a new line**. Never one chip per line.
- **At most 3 chips.** With more than 3, show the first 2 plus a **+N**
  button: 24px, dashed 1px `#6b7280` border, white, 12px / 600 `#374151`,
  `aria-label="N more attributes"`. It opens a popover listing the rest as
  full chips. Esc or an outside click closes it.
- **No table legend.** Chips label themselves, so remove the old top-right legend.

### Status label

Tinted pill: 24px tall, full radius, `0 12px` padding, 11px / **600**, 6px
gap, **14px icon always**. The text is the dark shade of its hue. Map states
by meaning, never by taste:

| Variant | Meaning | Fill / text | Icon | Example |
|---|---|---|---|---|
| `success` | done, funded, approved | `#e2fcdc` / `#14532d` | check-circle | Funded |
| `warning` | pending, in progress | `#fef3c7` / `#78350f` | clock | Pending |
| `danger` | unfunded, rejected, refunded | `#fee2e2` / `#7f1d1d` | dashed circle | Unfunded |
| `info` | in review, submitted | `#dbeafe` / `#1e3a8a` | dot-circle | In Review |
| `neutral` | draft, closed | `#f3f4f6` / `#374151` | minus-circle | Draft |

### Label (no icon)

A **status label's shape without the icon** — for a fixed attribute of the
record that is not a state, such as a TDC. 24px tall, full radius, `0 10px`
padding, 11px / **600**, fill `#e8f2ff` (`CB.labelBg`), text `#1560bd`
(`CB.brandPressed`, ≈5.5:1 on the fill — a solid `#2086ff` with white text is
only 3.6:1 and fails AA at this size). Long text ellipsizes inside the pill and
the full text goes in `title`. Component: `TagLabel`.

### Hyperlink label

The **Label plus a 12px link icon on its left** (`currentColor`, SVG Repo
"external link"), rendered as a `<button>`. Use it when clicking opens a
related record. It **always opens in a new tab** (`navigation.openForm` with
`openInNewWindow: true`), so the user keeps their place in the grid; the icon
is the promise of that. Hover fill `#d3e6ff` (`CB.labelBgHover`); keyboard
focus shows a 2px `#2086ff` ring; `aria-label` = "<text> (opens in a new tab)".
Component: `HyperlinkLabel`. Use `TagLabel` instead when the record has no
link target.

### Note cell: long free text in a grid

Comments don't get an inline Textarea in a row. The cell is a **read-only
preview capped at 120 × 50px** (11px, line-height 1, no resize, overflow
hidden) and the **whole box is clickable**. A **20px brand-blue (`#2086ff`)
rounded square (6px radius) with a white 12px icon** sits at its bottom-right
and says what clicking does:

| Text is | Icon | Tooltip |
|---|---|---|
| read-only | magnifier | "More" |
| editable (and the form is not locked) | pencil | "Edit" |

Clicking opens a **480 × 300px modal** (18px padding, 15px / 600 title) with a
**drop shadow and no dimming backdrop** — Power Apps' own page chrome makes a
dark overlay look awkward. (A transparent backdrop stays in place to block the
form behind it and catch "click outside to close".) It holds a Textarea
(min-height 120px, 13px, `0.5rem` padding) that is
**white** when read-only and **grey `#f7f7f7`** when editable, with **[Save]**
(editable only, enabled once the text changed) and **[Close]**. Save commits
and closes. Close, Esc or a backdrop click closes it, but with unsaved edits
the footer first asks "Close without saving your changes?" (**Keep editing** /
**Close without saving**). Component: `NoteCell`.

### Badge: action result

- Rendered **only** while a row has a pending action result. While saving,
  show a 12px spinner (`role="status"`, `aria-label="Saving"`) in the same spot.
- Sits **inline right after the item name**.
- Solid fill, white text: **Saved** `#15803d`, **Error** `#b91c1c`. 20px tall,
  4px radius, `0 6px` padding, 10.5px / **700** UPPERCASE, `.05em`
  letter-spacing, **12px icon always** (check / exclamation-in-circle).
- **Clears automatically:** Saved after 3 seconds. Error stays until the row's
  next save succeeds, and carries the tooltip "Save failed — re-check the value".

### Components (PCF)

Put these in `designSystem.tsx` and use them everywhere. **No inline styles per row.**

```tsx
// ── Tokens ───────────────────────────────────────────────────────────────
export const CHIP_HUES: Record<string, string> = {   // type → dot hue, in this order
  category: "#16a34a", qtyType: "#2563eb", class: "#7c3aed", origin: "#d97706", phase: "#0d9488",
  priority: "#db2777", fundingMode: "#4f46e5", lin: "#0891b2", country: "#65a30d",
};
export type StatusKind = "success" | "warning" | "danger" | "info" | "neutral";
export const STATUS: Record<StatusKind, { bg: string; fg: string; Icon: React.FC }> = {
  success: { bg: "#e2fcdc", fg: "#14532d", Icon: CheckCircleIcon },
  warning: { bg: "#fef3c7", fg: "#78350f", Icon: ClockIcon },
  danger:  { bg: "#fee2e2", fg: "#7f1d1d", Icon: DashedCircleIcon },
  info:    { bg: "#dbeafe", fg: "#1e3a8a", Icon: DotCircleIcon },
  neutral: { bg: "#f3f4f6", fg: "#374151", Icon: MinusCircleIcon },
};
// Status/badge icons use currentColor (paths: HTML reference §13), e.g.
// export const ClockIcon: React.FC = () => (<svg viewBox="0 0 640 640" aria-hidden="true">…</svg>);

const useTagStyles = makeStyles({
  chips: { display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "6px" },
  chip: {
    display: "inline-flex", alignItems: "center", columnGap: "6px", height: "24px", padding: "0 8px",
    boxSizing: "border-box", backgroundColor: "#fff", border: `1px solid ${CB.chipLine}`, borderRadius: "6px",
    fontSize: "12px", fontWeight: 400, lineHeight: 1, whiteSpace: "nowrap", color: CB.chipLabel,
  },
  chipValue: { fontWeight: 600, color: CB.chipValue },
  dot: { width: "8px", height: "8px", borderRadius: "50%", flexShrink: 0 },
  more: {
    height: "24px", padding: "0 8px", backgroundColor: "#fff", border: `1px dashed ${CB.chipMoreLine}`,
    borderRadius: "6px", fontSize: "12px", fontWeight: 600, color: CB.chipMoreText, cursor: "pointer",
    ":hover": { backgroundColor: tokens.colorSubtleBackgroundHover },
  },
  popover: { display: "flex", flexWrap: "wrap", gap: "6px", maxWidth: "300px", padding: "10px" },
  badge: {
    display: "inline-flex", alignItems: "center", columnGap: "4px", height: "20px", padding: "0 6px",
    borderRadius: "4px", color: "#fff", fontSize: "10.5px", fontWeight: 700, textTransform: "uppercase",
    letterSpacing: "0.05em", lineHeight: 1, whiteSpace: "nowrap",
    "& svg": { width: "12px", height: "12px", flexShrink: 0 },
  },
  status: {
    display: "inline-flex", alignItems: "center", columnGap: "6px", height: "28px", padding: "0 12px",
    borderRadius: "999px", fontSize: "13px", fontWeight: 600, lineHeight: 1, whiteSpace: "nowrap",
    "& svg": { width: "14px", height: "14px", flexShrink: 0 },
  },
  itemName: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: "4px 8px", fontWeight: 600 },
});

// ── Chip ─────────────────────────────────────────────────────────────────
export interface ChipData { type: keyof typeof CHIP_HUES | string; label: string; value: string }

export const Chip: React.FC<ChipData> = ({ type, label, value }) => {
  const s = useTagStyles();
  return (
    <span className={s.chip}>
      <span className={s.dot} style={{ backgroundColor: CHIP_HUES[type] ?? "#9ca3af" }} aria-hidden="true" />
      {label}: <span className={s.chipValue}>{value}</span>
    </span>
  );
};

/** Max 3 chips; with more, the first 2 + a "+N" button that opens a popover with the rest. */
export const ChipList: React.FC<{ chips: ChipData[] }> = ({ chips }) => {
  const s = useTagStyles();
  if (chips.length === 0) return null;
  const visible = chips.length > 3 ? chips.slice(0, 2) : chips;
  const rest = chips.slice(visible.length);
  return (
    <div className={s.chips}>
      {visible.map((c) => <Chip key={c.type} {...c} />)}
      {rest.length > 0 && (
        <Popover positioning="below-start">
          <PopoverTrigger disableButtonEnhancement>
            <button type="button" className={s.more} aria-label={`${rest.length} more attributes`}>
              +{rest.length}
            </button>
          </PopoverTrigger>
          <PopoverSurface className={s.popover} aria-label="More attributes">
            {rest.map((c) => <Chip key={c.type} {...c} />)}
          </PopoverSurface>
        </Popover>
      )}
    </div>
  );
};

// ── Status label ─────────────────────────────────────────────────────────
export const StatusLabel: React.FC<{ kind: StatusKind; children: React.ReactNode }> = ({ kind, children }) => {
  const s = useTagStyles();
  const { bg, fg, Icon } = STATUS[kind];
  return <span className={s.status} style={{ backgroundColor: bg, color: fg }}><Icon />{children}</span>;
};

// ── Badge (action result) ────────────────────────────────────────────────
export const Badge: React.FC<{ result: "saved" | "error" }> = ({ result }) => {
  const s = useTagStyles();
  const badge = result === "saved"
    ? <span className={s.badge} style={{ backgroundColor: CB.badgeSaved }}><BadgeCheckIcon />Saved</span>
    : <span className={s.badge} style={{ backgroundColor: CB.badgeError }}><BadgeAlertIcon />Error</span>;
  return result === "error"
    ? <Tooltip content="Save failed — re-check the value" relationship="description">{badge}</Tooltip>
    : badge;
};
```

```tsx
// Identity cell
<TableCell className={styles.firstCol}>
  <div className={tag.itemName}>
    <span>{itemDisplayName(row)}</span>
    {saveState[row.recordId] === "saving" && <Spinner size="extra-tiny" aria-label="Saving" />}
    {saveState[row.recordId] === "saved" && <Badge result="saved" />}   {/* cleared by a 3s timer */}
    {saveState[row.recordId] === "error" && <Badge result="error" />}   {/* cleared on next success */}
  </div>
  <ChipList chips={[
    { type: "category", label: "Category", value: ctx.category },
    { type: "qtyType",  label: "Qty Type", value: ctx.quantityType },
  ].filter((c) => c.value)} />
</TableCell>

// Status column
<TableCell><StatusLabel kind={statusKindFor(row)}>{row.statusName}</StatusLabel></TableCell>
```

### Feedback

- **Loading:** `<Spinner label="Loading X…" />` replaces the grid. Never show an
  empty table while loading.
- **Empty:** one muted sentence that names the fixing action ("Use **Add Items**
  to…"). Use a separate message for "No X match your search."
- **Errors:** inline `colorPaletteRedForeground1` text in dialogs. Banners for
  component-level problems. Never `alert()`.
- **Waiting for data (disabled control):** when a whole PCF can't work yet because
  the record is missing data it needs (unsaved record, Fiscal Year or Fund Center
  not set, a record type the control doesn't handle), it renders **one style
  only**: a plain sentence on a soft grey panel. Don't use a `MessageBar`, an
  icon or a border for this, and don't vary the style between controls.

  | Property | Value |
  |---|---|
  | Background | `colorNeutralBackground2` (`#fafafa`) |
  | Padding | `12px 16px` |
  | Radius | `borderRadiusMedium` (4px) |
  | Width | `100%` of the control |
  | Text | `<Text>`, 14px, `colorNeutralForeground1`, one sentence |

  The sentence names what's missing and what to do: "Save the Turn-In first
  to see the approval process." Use the same panel when there's nothing to do
  on this record (for example "This is a Sweep Turn-In… It has no lines to build.").
  Real problems are different: a failed load stays an error banner
  (`MessageBar intent="error"`), and a locked record stays a warning banner.

  ```tsx
  awaiting: {
    width: "100%", boxSizing: "border-box",
    ...shorthands.padding("12px", "16px"),
    backgroundColor: tokens.colorNeutralBackground2,
    ...shorthands.borderRadius(tokens.borderRadiusMedium),
  },
  // …
  <div className={styles.awaiting}><Text>Save the Turn-In first to see the approval process.</Text></div>
  ```

## 9. Toolbar & dialogs

**Toolbar order (left → right):** Title (count) · Selected (N) ‖ Search ·
Destructive · Create · **Refresh** (always last, always shown, even when
read-only). There is **no color legend**, because chips label themselves (§8). Edit actions are **hidden** when `isDisabled`.

**Dialogs:**
- `DialogSurface` max width `640px`. Scrollable lists capped at `360px`.
  A full-width search box comes first.
- Count line ("Adding: **N** Items", number in `colorPaletteGreenForeground1`)
  on its own row between `DialogContent` and `DialogActions`.
- Footer: `[Back] [Cancel]` secondary → `[Next / Add / Delete]` primary.
- While busy, disable every button and block dismiss:
  `onOpenChange={(_, d) => { if (!busy) setOpen(d.open); }}`.
- Every destructive action confirms, naming what will be removed.

---

## 10. Icons

The full library with copy-ready raw SVG is in
[Design/checkbook-design-system.html §13](Design/checkbook-design-system.html).
Rules:

- **Grid:** `viewBox="0 0 640 640"`. Rendered at 20px (Refresh 18px, in-field 16px).
- **Source of record:** Font Awesome **Free 7, Solid**. Keep the license
  comment (`<!--!Font Awesome Free … License - https://fontawesome.com/license/free …-->`).
  FA Free icons are CC BY 4.0.
- **Checkbook line icons** (Edit, Close, Check, Warning, Lock, Filter, Download, More, Sort,
  Open record, Chevrons) are stroke glyphs drawn for this system at stroke width
  48–64 with round caps. Replace one with its FA Free 7 equivalent whenever you
  add that icon to the repo.
- **SVG Repo icons** (Allocate / Split, Shuffle, Save) were drawn on a 32-unit grid. Their paths are kept
  unchanged and wrapped in `transform="scale(20)"` to fit the 640 viewBox. SVG Repo licenses vary
  per icon, so **check the license on svgrepo.com before shipping either one**.
- **Exception:** status-label and badge icons use `currentColor`, so they always match their tag's text.
- **Color is baked into the fill/stroke** from §2 (Add green, Delete red,
  neutral grey, Search light grey, Info/Transfer brand blue). Disabled state
  comes from the button's `saturate(0)` filter.
- Always `aria-hidden="true"` on the SVG. The **button** carries the label.

| Icon | Color | Use |
|---|---|---|
| Add | `#16ca92` | Create / Add Items |
| Delete | `#9f151e` | Delete, Remove, Delete Selected |
| Refresh | `#727272` | Reload data + totals |
| Search | `#989898` | Search field `contentBefore` |
| Info | `#2086ff` | Help tooltip trigger |
| Undo / Reset | `#727272` | Revert edits, reset filters |
| Transfer | `#2086ff` | Realignment, State Swap |
| Calendar | `#727272` | Dates, Spend Plan periods |
| Edit, Close, Filter, Download, Open record, Chevrons | `#727272` | As named |
| More (⋯) | `#424242` | Row overflow menu, always the last row action |
| Sort | `#8a8a8a` idle, `#242424` active half | Sortable table headers, 12px. Colored by CSS via `aria-sort` |
| Check-circle · Clock · Dashed circle · Dot-circle · Minus-circle | `currentColor` | Status label icons (success · warning · danger · info · neutral), 14px |
| Badge check · Badge alert | `currentColor` (white) | Saved / Error badge icons, 12px |
| Save (floppy disk) | `currentColor`, set to `#727272` | Save buttons. SVG Repo `save-floppy` |
| Allocate / Split | `#727272` | One amount splitting into two (distributions, allocations). Row action **Allocate to RFs** in PrioritizationFundingGrid. SVG Repo `alt-split` |
| Shuffle | `#727272` | *Reserved, not used yet.* Reassign between targets (realignments, swaps). SVG Repo `arrows-shuffle` |
| Check | `#107c10` | Approve / validated |
| Warning | `#8a5c00` | Warnings |
| Lock | `#727272` | Funding / Spend Plan lock |

### Shared module (recommended for new work)

The Itemized Details Grid defines its icons and literals inline. New
components should **not** copy-paste them. Each PCF project builds on its own,
so keep one canonical copy per control in `<Control>/components/designSystem.tsx`,
copied from the snippet below, until a shared npm workspace exists:

```tsx
// designSystem.tsx — Checkbook design tokens + icons (Design Documentation.md §2, §10)
import * as React from "react";

export const CB = {
  rowHover:   "#fbfbfb",
  inputFill:  "#f7f7f7",
  inputHover: "#b2c3f4",
  add:        "#16ca92",
  danger:     "#9f151e",
  iconNeutral:"#727272",
  iconSubtle: "#989898",
  link:       "#5b9bd5",
  linkHover:  "#2e5f8a",
  brand:      "#2086ff",
  controlLine:"#d9d9d9",
  controlHoverBg: "#f1f6ff",
  adornment:  "#5c5875",
  chipLine:   "#d1d5db",
  chipLabel:  "#4b5563",
  chipValue:  "#111827",
  chipMoreLine: "#6b7280",
  chipMoreText: "#374151",
  badgeSaved: "#15803d",
  badgeError: "#b91c1c",
  focusRing:  "rgba(32, 134, 255, .18)",
  error:      "#d13438",
  errorRing:  "rgba(209, 52, 56, .15)",
  switchOff:  "#c8c8c8",
  switchGood: "#22b35e",
  switchBad:  "#e5484d",
  tableHead:  "#f7f7f7",
  rowLine:    "#f0f0f0",
  rowSelected:"#f5f9ff",
  sortIdle:   "#8a8a8a",
} as const;
// checkbookTheme (§2) and useChoiceStyles (§6.1) also live in this file.

const Svg: React.FC<{ size?: number; children: React.ReactNode }> = ({ size = 20, children }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width={size} height={size} aria-hidden="true">
    {children}
  </svg>
);

/* Font Awesome Free 7 — https://fontawesome.com/license/free (CC BY 4.0) */
export const AddIcon: React.FC = () => (
  <Svg><path fill={CB.add} d="M352 128C352 110.3 337.7 96 320 96C302.3 96 288 110.3 288 128L288 288L128 288C110.3 288 96 302.3 96 320C96 337.7 110.3 352 128 352L288 352L288 512C288 529.7 302.3 544 320 544C337.7 544 352 529.7 352 512L352 352L512 352C529.7 352 544 337.7 544 320C544 302.3 529.7 288 512 288L352 288L352 128z" /></Svg>
);
// DeleteIcon, RefreshIcon (size 18), SearchIcon … paths: copy from the HTML reference §13.
```

---

## 11. HTML Web Resources

HTML web resources can't use Fluent React, so they use the CSS kit instead:

1. Copy the `<style id="checkbook-kit">` block from
   [Design/checkbook-design-system.html](Design/checkbook-design-system.html)
   into the web resource's `<head>`. Every web resource is a standalone file
   in Dataverse, so inline the kit rather than linking a shared CSS file.
2. Add `class="cb-root"` to `<body>`.
3. Build with the kit classes. They map 1:1 to the PCF rules above:

| Need | Classes |
|---|---|
| Action / destructive / icon-only button | `cb-btn` · `cb-btn cb-btn-danger` · `cb-btn cb-btn-icon` |
| Dialog buttons | `cb-btn cb-btn-primary` · `cb-btn cb-btn-secondary` |
| Inputs | `cb-input` · `cb-input cb-input-number` (other numerics) · `cb-select` · `cb-textarea` · `cb-search` wrapper |
| Money / quantity | `label.cb-num` > `span.cb-num-adorn` (`$` / `#`) + `input.cb-money` / `input.cb-qty`, plus the `checkbook-numeric` script (§6.2) |
| Checkbox / radio / switch | `label.cb-checkbox` · `label.cb-radio` (group: `cb-radio-group`, add `.inline` for horizontal) · `label.cb-switch` · `label.cb-switch.goodbad`. Mixed state: set `input.indeterminate = true` in script. |
| Grid | `cb-table-scroll` > `table.cb-table` (add `.compact` in dialogs). Cells: `num`, `ctx`, `sel`, `act`. Rows: `is-selected`, `cb-loadmore`, `cb-totals`. Sortable header: `th.sortable[aria-sort]` + the Sort icon with class `cb-sort` |
| Chips | `div.cb-chips` > `span.cb-chip[data-type=category\|qtytype\|class\|origin\|phase]` with `Label: <b>Value</b>`. Overflow: `button.cb-chip-more` + `div.cb-chip-popover` and the `checkbook-chips` script |
| Status label | `span.cb-status.cb-status-success\|warning\|danger\|info\|neutral` with its icon first |
| Badge | `div.cb-item-name` > name + `span.cb-badge.cb-badge-saved\|error` with its icon first |
| Feedback | `cb-loading` + `cb-spinner` · `cb-empty` · `cb-banner cb-banner-error\|warn\|success` |
| Layout | `cb-toolbar` > `cb-toolbar-left` / `cb-toolbar-right`, `cb-title`, `cb-selected` |

Keep `formContext` / `Xrm.WebApi` usage per the review guidelines in
[CLAUDE.md](CLAUDE.md). This document covers presentation only.

---

## 12. Review checklist

Copy into the PR description for any new or restyled component.

- [ ] PCF wraps in `<FluentProvider theme={checkbookTheme}>`. HTML includes `checkbook-kit` and `cb-root`.
- [ ] No hex outside §2. No Fluent v8 colors.
- [ ] Toolbar/row buttons are `subtle`, borderless, have an icon, and show a hover background.
- [ ] Icon-only buttons have an `aria-label` and a tooltip.
- [ ] Disabled = `opacity: .7; filter: saturate(0)`, no color swap.
- [ ] Primary/secondary buttons only in dialog footers.
- [ ] Checkbox / radio / switch per §6.1: `#d9d9d9` outline, `#2086ff` when on, blue label on hover. Switch uses `goodbad` only when both states carry meaning.
- [ ] Editable inputs: `#f7f7f7` fill, `#b2c3f4` 2px hover border. Read-only: no fill. Locked: plain text.
- [ ] Numbers right-aligned (header too), tabular, USD, no spinners.
- [ ] Money (`$`) and quantity (`#`) use the §6.2 numeric box: grey fill, no border at rest (white + border on hover/focus), 6px radius, bold prefix on the left. Formatted unfocused, raw and fully selected on focus, `type="text"`. Esc reverts. Never saves NaN or a blank as 0.
- [ ] Grid is spacious (56px rows, `12px 16px` cells, 40px `#f7f7f7` header band, `#f0f0f0` hairlines). Headers are 11px / 700 / UPPERCASE.
- [ ] Grid: sticky header, sticky all-record totals, Load more, 560px max height, `tableLayout: auto`. Row actions are Edit · Delete · More.
- [ ] Tags follow the three tiers (§8). Chips: outlined `Label: Value`, dot, max 3 then 2 + `+N`, wrapping. Status label: tinted, icon, own column. Badge: solid, icon, inline after the name, clears itself (Error has a tooltip). No table legend. All via the shared `Chip` / `ChipList` / `StatusLabel` / `Badge`.
- [ ] Spinner with label while loading. Guidance empty state plus a separate no-match message.
- [ ] A control waiting for record data (save first, set the Fiscal Year…) shows the single §8 "Waiting for data" grey panel, not a `MessageBar`.
- [ ] Destructive actions confirm. Busy dialogs block dismiss.
- [ ] Icons from §10 (640 viewBox, `aria-hidden`, FA license comment kept).
- [ ] Visible keyboard focus on all interactive elements.

## 13. Changing the standard

1. Propose the change against the Itemized Details Grid baseline (what it does
   today and why it should change).
2. Update **this file and** `Design/checkbook-design-system.html` in the same PR.
3. Bump the version in the header table.
