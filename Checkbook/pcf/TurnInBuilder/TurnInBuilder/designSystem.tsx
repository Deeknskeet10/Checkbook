/**
 * Checkbook design system — shared tokens, theme, icons and components.
 * Source of truth: Checkbook/Design Documentation.md (+ Design/checkbook-design-system.html).
 * Keep this file identical across PCF controls until a shared package exists.
 * (TurnInBuilder copy: SaveIcon also takes an optional `color`; the default is unchanged.)
 */
import * as React from "react";
import {
  webLightTheme,
  Theme,
  makeStyles,
  mergeClasses,
  shorthands,
  tokens,
  Input,
  Popover,
  PopoverTrigger,
  PopoverSurface,
  Tooltip,
  Spinner,
  Button,
  Textarea,
  Dialog,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogContent,
  DialogActions,
} from "@fluentui/react-components";

// ─── Tokens (Design Documentation.md §2) ────────────────────────────────────

export const CB = {
  brand: "#2086ff",
  brandHover: "#1a74e0",
  brandPressed: "#1560bd",

  rowHover: "#fbfbfb",
  rowSelected: "#f5f9ff",
  rowLine: "#f0f0f0",
  tableHead: "#f7f7f7",
  sortIdle: "#8a8a8a",

  inputFill: "#f7f7f7",
  inputHover: "#b2c3f4",
  adornment: "#5c5875",
  focusRing: "rgba(32, 134, 255, .18)",
  error: "#d13438",
  errorRing: "rgba(209, 52, 56, .15)",

  controlLine: "#d9d9d9",
  controlHoverBg: "#f1f6ff",

  add: "#16ca92",
  danger: "#9f151e",
  iconNeutral: "#727272",
  iconSubtle: "#989898",
  link: "#5b9bd5",
  linkHover: "#2e5f8a",

  /** Brand tag label (TagLabel): brand-blue tint; text is brandPressed for AA contrast. */
  labelBg: "#e8f2ff",
  labelBgHover: "#d3e6ff",

  chipLine: "#d1d5db",
  chipLabel: "#4b5563",
  chipValue: "#111827",
  chipMoreLine: "#6b7280",
  chipMoreText: "#374151",
  badgeSaved: "#15803d",
  badgeError: "#b91c1c",
} as const;

/** webLightTheme with the softer Checkbook brand blue (§2 "Brand theme"). */
export const checkbookTheme: Theme = {
  ...webLightTheme,
  colorBrandBackground: CB.brand,
  colorBrandBackgroundHover: CB.brandHover,
  colorBrandBackgroundPressed: CB.brandPressed,
  colorBrandBackgroundSelected: CB.brandHover,
  colorBrandForeground1: CB.brand,
  colorBrandForeground2: CB.brandHover,
  colorBrandForegroundLink: CB.brand,
  colorBrandForegroundLinkHover: CB.brandHover,
  colorBrandForegroundLinkPressed: CB.brandPressed,
  colorBrandStroke1: CB.brand,
  colorBrandBackground2: "#e8f2ff",
  colorBrandBackground2Pressed: "#b3d4ff",
  colorCompoundBrandBackground: CB.brand,
  colorCompoundBrandBackgroundHover: CB.brandHover,
  colorCompoundBrandBackgroundPressed: CB.brandPressed,
  colorCompoundBrandStroke: CB.brand,
  colorCompoundBrandStrokeHover: CB.brandHover,
  colorCompoundBrandStrokePressed: CB.brandPressed,
  colorCompoundBrandForeground1: CB.brand,
  colorCompoundBrandForeground1Hover: CB.brandHover,
  colorCompoundBrandForeground1Pressed: CB.brandPressed,
};

// ─── Icons (§10; 640 grid, aria-hidden) ─────────────────────────────────────

const Svg: React.FC<{ size?: number; children: React.ReactNode }> = ({ size = 20, children }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width={size} height={size} aria-hidden="true">
    {children}
  </svg>
);

/* Font Awesome Free 7 — https://fontawesome.com/license/free (CC BY 4.0) */
export const AddIcon: React.FC<{ size?: number }> = ({ size }) => (
  <Svg size={size}>
    <path
      fill={CB.add}
      d="M352 128C352 110.3 337.7 96 320 96C302.3 96 288 110.3 288 128L288 288L128 288C110.3 288 96 302.3 96 320C96 337.7 110.3 352 128 352L288 352L288 512C288 529.7 302.3 544 320 544C337.7 544 352 529.7 352 512L352 352L512 352C529.7 352 544 337.7 544 320C544 302.3 529.7 288 512 288L352 288L352 128z"
    />
  </Svg>
);

export const DeleteIcon: React.FC<{ size?: number }> = ({ size }) => (
  <Svg size={size}>
    <path
      fill={CB.danger}
      d="M232.7 69.9C237.1 56.8 249.3 48 263.1 48L377 48C390.8 48 403 56.8 407.4 69.9L416 96L512 96C529.7 96 544 110.3 544 128C544 145.7 529.7 160 512 160L128 160C110.3 160 96 145.7 96 128C96 110.3 110.3 96 128 96L224 96L232.7 69.9zM128 208L512 208L512 512C512 547.3 483.3 576 448 576L192 576C156.7 576 128 547.3 128 512L128 208zM216 272C202.7 272 192 282.7 192 296L192 488C192 501.3 202.7 512 216 512C229.3 512 240 501.3 240 488L240 296C240 282.7 229.3 272 216 272zM320 272C306.7 272 296 282.7 296 296L296 488C296 501.3 306.7 512 320 512C333.3 512 344 501.3 344 488L344 296C344 282.7 333.3 272 320 272zM424 272C410.7 272 400 282.7 400 296L400 488C400 501.3 410.7 512 424 512C437.3 512 448 501.3 448 488L448 296C448 282.7 437.3 272 424 272z"
    />
  </Svg>
);

export const RefreshIcon: React.FC<{ size?: number }> = ({ size = 18 }) => (
  <Svg size={size}>
    <path
      fill={CB.iconNeutral}
      d="M320 128C263.2 128 212.1 152.7 176.9 192L224 192C241.7 192 256 206.3 256 224C256 241.7 241.7 256 224 256L96 256C78.3 256 64 241.7 64 224L64 96C64 78.3 78.3 64 96 64C113.7 64 128 78.3 128 96L128 150.7C174.9 97.6 243.5 64 320 64C461.4 64 576 178.6 576 320C576 461.4 461.4 576 320 576C233 576 156.1 532.6 109.9 466.3C99.8 451.8 103.3 431.9 117.8 421.7C132.3 411.5 152.2 415.1 162.4 429.6C197.2 479.4 254.8 511.9 320 511.9C426 511.9 512 425.9 512 319.9C512 213.9 426 128 320 128z"
    />
  </Svg>
);

export const SearchIcon: React.FC<{ size?: number; color?: string }> = ({ size = 16, color = CB.iconSubtle }) => (
  <Svg size={size}>
    <path
      fill={color}
      d="M480 272C480 317.9 465.1 360.3 440 394.7L566.6 521.4C579.1 533.9 579.1 554.2 566.6 566.7C554.1 579.2 533.8 579.2 521.3 566.7L394.7 440C360.3 465.1 317.9 480 272 480C157.1 480 64 386.9 64 272C64 157.1 157.1 64 272 64C386.9 64 480 157.1 480 272zM272 416C351.5 416 416 351.5 416 272C416 192.5 351.5 128 272 128C192.5 128 128 192.5 128 272C128 351.5 192.5 416 272 416z"
    />
  </Svg>
);

/* Checkbook line icons — currentColor, so they follow the text of their tag. */
export const BadgeCheckIcon: React.FC = () => (
  <Svg size={12}>
    <path d="M144 336L272 464L496 192" fill="none" stroke="currentColor" strokeWidth={88} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

export const BadgeAlertIcon: React.FC = () => (
  <Svg size={12}>
    <circle cx="320" cy="320" r="232" fill="none" stroke="currentColor" strokeWidth={64} />
    <path d="M320 200L320 344" fill="none" stroke="currentColor" strokeWidth={72} strokeLinecap="round" />
    <circle cx="320" cy="440" r="44" fill="currentColor" />
  </Svg>
);

/* Checkbook line icons — neutral #727272 (§10). */
export const EditIcon: React.FC<{ size?: number; color?: string }> = ({ size, color = CB.iconNeutral }) => (
  <Svg size={size}>
    <path d="M400 128L512 240L256 496L128 512L144 384Z M352 176L464 288" fill="none" stroke={color}
      strokeWidth={48} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

export const CloseIcon: React.FC<{ size?: number }> = ({ size }) => (
  <Svg size={size}>
    <path d="M192 192L448 448M448 192L192 448" fill="none" stroke={CB.iconNeutral} strokeWidth={64} strokeLinecap="round" />
  </Svg>
);

/** Chevron right when closed, down when open (expand row / section). */
export const ChevronIcon: React.FC<{ open: boolean; size?: number }> = ({ open, size = 16 }) => (
  <Svg size={size}>
    <path d={open ? "M176 256L320 400L464 256" : "M256 176L400 320L256 464"} fill="none" stroke={CB.iconNeutral}
      strokeWidth={64} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

/* Font Awesome Free 7 — rotate-left */
export const UndoIcon: React.FC<{ size?: number }> = ({ size }) => (
  <Svg size={size}>
    <path
      fill={CB.iconNeutral}
      d="M88 256L232 256C241.7 256 250.5 250.2 254.2 241.2C257.9 232.2 255.9 221.9 249 215L202.3 168.3C277.6 109.7 386.6 115 455.8 184.2C530.8 259.2 530.8 380.7 455.8 455.7C380.8 530.7 259.3 530.7 184.3 455.7C174.1 445.5 165.3 434.4 157.9 422.7C148.4 407.8 128.6 403.4 113.7 412.9C98.8 422.4 94.4 442.2 103.9 457.1C113.7 472.7 125.4 487.5 139 501C239 601 401 601 501 501C601 401 601 239 501 139C406.8 44.7 257.3 39.3 156.7 122.8L105 71C98.1 64.2 87.8 62.1 78.8 65.8C69.8 69.5 64 78.3 64 88L64 232C64 245.3 74.7 256 88 256z"
    />
  </Svg>
);

/* SVG Repo — save-floppy (32-unit path ×20). Verify the license before shipping. */
export const SaveIcon: React.FC<{ size?: number; color?: string }> = ({ size, color = CB.iconNeutral }) => (
  <Svg size={size}>
    <path
      fill={color}
      fillRule="evenodd"
      transform="scale(20) translate(-154 -517)"
      d="M172,522 C172,521.447 172.448,521 173,521 C173.552,521 174,521.447 174,522 L174,526 C174,526.553 173.552,527 173,527 C172.448,527 172,526.553 172,526 L172,522 L172,522 Z M163,529 L177,529 C177.552,529 178,528.553 178,528 L178,517 L162,517 L162,528 C162,528.553 162.448,529 163,529 L163,529 Z M182,517 L180,517 L180,529 C180,530.104 179.104,531 178,531 L162,531 C160.896,531 160,530.104 160,529 L160,517 L158,517 C155.791,517 154,518.791 154,521 L154,545 C154,547.209 155.791,549 158,549 L182,549 C184.209,549 186,547.209 186,545 L186,521 C186,518.791 184.209,517 182,517 L182,517 Z"
    />
  </Svg>
);

/* SVG Repo — alt-split (32-unit path ×20). Verify the license before shipping. */
export const AllocateIcon: React.FC<{ size?: number; color?: string }> = ({ size, color = CB.iconNeutral }) => (
  <Svg size={size}>
    <path
      fill={color}
      transform="scale(20)"
      d="M0.032 26.336q-0.096-0.576 0.128-1.12t0.704-0.864 1.152-0.352h1.984v-4q0-2.464 1.728-4.224t4.256-1.76h12q0.8 0 1.408-0.576t0.608-1.44v-9.984q0-0.832 0.576-1.408t1.44-0.608 1.408 0.608 0.576 1.408v9.984q0 2.496-1.76 4.256t-4.256 1.76h-12q-0.832 0-1.408 0.576t-0.576 1.408v4h2.016q0.64 0 1.152 0.384t0.704 0.864 0.096 1.12-0.544 1.056l-4 4q-0.64 0.608-1.44 0.608t-1.408-0.608l-4-4q-0.48-0.48-0.544-1.088zM20.032 26.368q-0.096-0.608 0.128-1.152t0.704-0.864 1.152-0.352h1.984v-4.256q1.536-0.32 2.336-0.832t1.664-1.664v6.752l2.016 0.032q0.64 0 1.152 0.352t0.704 0.896 0.096 1.12-0.544 1.024l-4 4.032q-0.64 0.576-1.44 0.576t-1.376-0.576l-4-4.032q-0.48-0.448-0.576-1.056z"
    />
  </Svg>
);

/* Status-label icons — currentColor, 14px (§8). */
const CheckCircleIcon: React.FC = () => (
  <Svg size={14}>
    <circle cx="320" cy="320" r="232" fill="none" stroke="currentColor" strokeWidth={56} />
    <path d="M216 328L288 400L432 248" fill="none" stroke="currentColor" strokeWidth={56} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);
const ClockIcon: React.FC = () => (
  <Svg size={14}>
    <circle cx="320" cy="320" r="232" fill="none" stroke="currentColor" strokeWidth={56} />
    <path d="M320 192L320 320L408 376" fill="none" stroke="currentColor" strokeWidth={56} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);
const DashedCircleIcon: React.FC = () => (
  <Svg size={14}>
    <circle cx="320" cy="320" r="232" fill="none" stroke="currentColor" strokeWidth={56} strokeDasharray="91 91" strokeLinecap="round" />
  </Svg>
);
const DotCircleIcon: React.FC = () => (
  <Svg size={14}>
    <circle cx="320" cy="320" r="232" fill="none" stroke="currentColor" strokeWidth={56} />
    <circle cx="320" cy="320" r="80" fill="currentColor" />
  </Svg>
);
const MinusCircleIcon: React.FC = () => (
  <Svg size={14}>
    <circle cx="320" cy="320" r="232" fill="none" stroke="currentColor" strokeWidth={56} />
    <path d="M216 320L424 320" fill="none" stroke="currentColor" strokeWidth={56} strokeLinecap="round" />
  </Svg>
);

/* SVG Repo — external link (24-unit viewBox), currentColor, 12px. Verify the license before shipping. */
export const LinkIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width={12} height={12} aria-hidden="true" fill="none">
    <path
      d="M20.2929 9.70708C20.5789 9.99307 21.009 10.0786 21.3827 9.92385C21.7564 9.76907 22 9.40443 22 8.99997V2.99997C22 2.44768 21.5523 1.99997 21 1.99997H15C14.5955 1.99997 14.2309 2.24361 14.0761 2.61729C13.9213 2.99096 14.0069 3.42108 14.2929 3.70708L16.2322 5.64641L9.58574 12.2929C9.19522 12.6834 9.19522 13.3166 9.58574 13.7071L10.2928 14.4142C10.6834 14.8048 11.3165 14.8048 11.7071 14.4142L18.3536 7.76774L20.2929 9.70708Z"
      fill="currentColor"
    />
    <path
      d="M4.5 8.00006C4.5 7.72392 4.72386 7.50006 5 7.50006H10.0625C10.6148 7.50006 11.0625 7.05234 11.0625 6.50006V5.50006C11.0625 4.94777 10.6148 4.50006 10.0625 4.50006H5C3.067 4.50006 1.5 6.06706 1.5 8.00006V19.0001C1.5 20.9331 3.067 22.5001 5 22.5001H16C17.933 22.5001 19.5 20.9331 19.5 19.0001V13.9376C19.5 13.3853 19.0523 12.9376 18.5 12.9376H17.5C16.9477 12.9376 16.5 13.3853 16.5 13.9376V19.0001C16.5 19.2762 16.2761 19.5001 16 19.5001H5C4.72386 19.5001 4.5 19.2762 4.5 19.0001V8.00006Z"
      fill="currentColor"
    />
  </svg>
);

/** Sort chevrons: both halves idle grey; the active direction darkens (§7). */
export const SortIcon: React.FC<{ direction: "asc" | "desc" | null }> = ({ direction }) => {
  const idle = CB.sortIdle;
  const on = tokens.colorNeutralForeground1;
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width={18} height={18} aria-hidden="true"
      style={{ marginLeft: 4, flexShrink: 0 }}>
      <path d="M208 272L320 160L432 272" fill="none" stroke={direction === "asc" ? on : idle}
        strokeWidth={64} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M208 368L320 480L432 368" fill="none" stroke={direction === "desc" ? on : idle}
        strokeWidth={64} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};

// ─── Choice controls (§6.1) ─────────────────────────────────────────────────

const choiceRow = {
  padding: "5px",
  borderRadius: "5px",
  transitionProperty: "background-color",
  transitionDuration: "120ms",
  ":hover": { backgroundColor: CB.controlHoverBg },
  ":has(input:disabled):hover": { backgroundColor: "transparent" },
} as const;

export const useChoiceStyles = makeStyles({
  checkbox: {
    ...choiceRow,
    ":hover .fui-Checkbox__label": { color: CB.brand },
    ":hover .fui-Checkbox__input:enabled:not(:checked) ~ .fui-Checkbox__indicator": {
      ...shorthands.borderColor(`${CB.brand} !important`),
    },
  },
  /** Grid select cells: no row padding, so the column stays 44px. */
  checkboxBare: {
    ":hover .fui-Checkbox__input:enabled:not(:checked) ~ .fui-Checkbox__indicator": {
      ...shorthands.borderColor(`${CB.brand} !important`),
    },
  },
  checkboxBox: {
    width: "18px",
    height: "18px",
    borderRadius: "4px",
    border: `1.5px solid ${CB.controlLine}`,
  },
});

// ─── Buttons (§5) ───────────────────────────────────────────────────────────

const disabledButton = { opacity: 0.7, filter: "saturate(0)", cursor: "not-allowed" } as const;

export const useButtonStyles = makeStyles({
  /** Action (default): subtle, icon + 14px label. */
  action: {
    fontSize: "14px",
    color: tokens.colorNeutralForeground1,
    ...shorthands.padding("10px", "14px"),
    ":disabled": disabledButton,
    "&[aria-disabled='true']": disabledButton,
  },
  /** Destructive: action spec, red label. */
  destructive: {
    fontSize: "14px",
    color: CB.danger,
    ...shorthands.padding("10px", "14px"),
    ":disabled": disabledButton,
    "&[aria-disabled='true']": disabledButton,
  },
  /** Icon-only: 30px square, 16px icon. Always pair with aria-label + Tooltip. */
  icon: {
    minWidth: "30px",
    width: "30px",
    height: "30px",
    ...shorthands.padding("0"),
    ":disabled": disabledButton,
    "&[aria-disabled='true']": disabledButton,
  },
  /** Load more: full width, 40px, link blue. */
  loadMore: {
    width: "100%",
    minHeight: "40px",
    justifyContent: "center",
    fontWeight: 600,
    fontSize: "15px",
    borderRadius: 0,
    color: CB.link,
    ":hover": { color: CB.linkHover },
  },
});

// ─── Numeric inputs: Money ($) / Quantity (#) (§6.2) ────────────────────────

type NumericKind = "money" | "quantity";

const fmtCache = new Map<string, Intl.NumberFormat>();
const nf = (min: number, max: number): Intl.NumberFormat => {
  const key = `${min}:${max}`;
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat("en-US", { minimumFractionDigits: min, maximumFractionDigits: max });
    fmtCache.set(key, f);
  }
  return f;
};
const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** "$1,250.50" — read-only text and totals (no box). */
export const formatMoney = (n: number | null): string => (n === null ? "" : USD.format(n));
/** Unfocused text inside the box: "1,250.50" / "1,200". */
export const formatInBox = (kind: NumericKind, n: number | null, decimals: number): string =>
  n === null ? "" : nf(kind === "money" ? 2 : 0, decimals).format(n);
/** Focused text: "1250.50" / "1200". */
export const rawNumber = (kind: NumericKind, n: number | null): string =>
  n === null ? "" : kind === "money" && !Number.isInteger(n) ? n.toFixed(2) : String(n);
/** null = empty, NaN = invalid. */
export const parseNumber = (kind: NumericKind, text: string, decimals: number): number | null => {
  const c = text.replace(/[^0-9.-]/g, "");
  if (c === "") return null;
  const n = Number(c);
  if (!Number.isFinite(n)) return NaN;
  const f = 10 ** decimals;
  if (kind === "quantity") return n < 0 || Math.round(n * f) / f !== n ? NaN : n; // reject, don't round
  return Math.round(n * f) / f; // money: round to cents
};

const useNumericStyles = makeStyles({
  box: {
    backgroundColor: CB.inputFill,
    border: "1px solid transparent",
    borderRadius: "6px",
    minHeight: "32px",
    paddingLeft: "10px",
    paddingRight: "10px",
    columnGap: "8px",
    ":hover": { backgroundColor: "#fff", ...shorthands.borderColor(`${CB.inputHover} !important`) },
    ":focus-within": {
      backgroundColor: "#fff",
      ...shorthands.borderColor(`${CB.brand} !important`),
      boxShadow: `0 0 0 3px ${CB.focusRing}`,
    },
    "::after": { display: "none" },
    "& input": {
      textAlign: "right",
      fontVariantNumeric: "tabular-nums",
      paddingLeft: 0,
      paddingRight: 0,
      minWidth: 0,
    },
  },
  invalid: {
    ...shorthands.borderColor(`${CB.error} !important`),
    boxShadow: `0 0 0 3px ${CB.errorRing}`,
  },
  prefix: { color: CB.adornment, fontSize: "14px", fontWeight: 700, userSelect: "none" },
});

export interface NumericInputProps {
  value: number | null;
  /** Called only when the number changed. */
  onCommit: (value: number | null) => void;
  /** Called when the typed text is rejected (old value is kept). */
  onInvalid?: () => void;
  /** Quantity only; money is always 2. */
  decimals?: number;
  disabled?: boolean;
  className?: string;
  /**
   * Also commit every valid keystroke (Esc still restores the value the box had
   * on focus). For batch edits whose totals / Save state must track typing.
   */
  live?: boolean;
  "aria-label"?: string;
}

// Plain functions (not React.FC) so no implicit `children` is spread onto <Input>.
export const NumericInput = ({
  kind,
  value,
  onCommit,
  onInvalid,
  decimals,
  disabled,
  className,
  live,
  ...aria
}: NumericInputProps & { kind: NumericKind }): JSX.Element => {
  const s = useNumericStyles();
  const dec = kind === "money" ? 2 : decimals ?? 0;
  const [focused, setFocused] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [invalid, setInvalid] = React.useState(false);
  const cancel = React.useRef(false);
  const justFocused = React.useRef(false);
  const startValue = React.useRef<number | null>(value);

  return (
    <Input
      {...aria}
      type="text"
      inputMode={kind === "money" || dec > 0 ? "decimal" : "numeric"}
      appearance="outline"
      className={mergeClasses(s.box, invalid && s.invalid, className)}
      contentBefore={
        <span className={s.prefix} aria-hidden="true">
          {kind === "money" ? "$" : "#"}
        </span>
      }
      disabled={disabled}
      placeholder={kind === "money" ? "0.00" : "0"}
      value={focused ? draft : formatInBox(kind, value, dec)}
      onFocus={(e) => {
        const el = e.currentTarget;
        setInvalid(false);
        startValue.current = value;
        setDraft(rawNumber(kind, value));
        setFocused(true);
        justFocused.current = true;
        // After the raw value renders. select() also focuses in Chromium, so
        // only select if the box still has focus (a fast Tab/blur must win).
        requestAnimationFrame(() => {
          if (el.ownerDocument.activeElement === el) el.select();
        });
      }}
      onMouseUp={(e) => {
        // keep the selection made on click-focus
        if (justFocused.current) {
          e.preventDefault();
          justFocused.current = false;
        }
      }}
      onChange={(_e, d) => {
        const next = d.value.replace(/[^0-9.-]/g, "");
        setDraft(next);
        if (live) {
          const n = parseNumber(kind, next, dec);
          if (!(n !== null && Number.isNaN(n)) && n !== value) onCommit(n);
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          cancel.current = true;
          if (live && value !== startValue.current) onCommit(startValue.current);
          e.currentTarget.blur();
        }
      }}
      onBlur={() => {
        setFocused(false);
        justFocused.current = false;
        if (cancel.current) {
          cancel.current = false;
          return;
        }
        const n = parseNumber(kind, draft, dec);
        if (n !== null && Number.isNaN(n)) {
          setInvalid(true);
          onInvalid?.();
          return;
        }
        if (n !== value) onCommit(n);
      }}
    />
  );
};

export const MoneyInput = (p: Omit<NumericInputProps, "decimals">): JSX.Element => (
  <NumericInput kind="money" {...p} />
);
export const QuantityInput = (p: NumericInputProps): JSX.Element => <NumericInput kind="quantity" {...p} />;

// ─── Tags: Chip / ChipList / Badge (§8) ─────────────────────────────────────

/** Attribute type → dot hue, in this order. New types get the next hue here. */
export const CHIP_HUES: Record<string, string> = {
  category: "#16a34a",
  qtyType: "#2563eb",
  class: "#7c3aed",
  origin: "#d97706",
  phase: "#0d9488",
  priority: "#db2777",
  fundingMode: "#4f46e5",
  lin: "#0891b2",
  country: "#65a30d",
  // TurnInBuilder: Itemized Detail chips (TDC green, MDEP blue, as on the Itemized Details Grid).
  tdc: "#16a34a",
  mdep: "#2563eb",
};

export type StatusKind = "success" | "warning" | "danger" | "info" | "neutral";
export const STATUS: Record<StatusKind, { bg: string; fg: string; Icon: React.FC }> = {
  success: { bg: "#e2fcdc", fg: "#14532d", Icon: CheckCircleIcon },
  warning: { bg: "#fef3c7", fg: "#78350f", Icon: ClockIcon },
  danger: { bg: "#fee2e2", fg: "#7f1d1d", Icon: DashedCircleIcon },
  info: { bg: "#dbeafe", fg: "#1e3a8a", Icon: DotCircleIcon },
  neutral: { bg: "#f3f4f6", fg: "#374151", Icon: MinusCircleIcon },
};

const useTagStyles = makeStyles({
  chips: { display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "6px" },
  chip: {
    display: "inline-flex",
    alignItems: "center",
    columnGap: "6px",
    height: "24px",
    padding: "0 8px",
    boxSizing: "border-box",
    backgroundColor: "#fff",
    border: `1px solid ${CB.chipLine}`,
    borderRadius: "6px",
    fontSize: "12px",
    fontWeight: 400,
    lineHeight: 1,
    whiteSpace: "nowrap",
    color: CB.chipLabel,
  },
  chipValue: { fontWeight: 600, color: CB.chipValue },
  dot: { width: "8px", height: "8px", borderRadius: "50%", flexShrink: 0 },
  more: {
    height: "24px",
    padding: "0 8px",
    backgroundColor: "#fff",
    border: `1px dashed ${CB.chipMoreLine}`,
    borderRadius: "6px",
    fontFamily: "inherit",
    fontSize: "12px",
    fontWeight: 600,
    color: CB.chipMoreText,
    cursor: "pointer",
    ":hover": { backgroundColor: tokens.colorSubtleBackgroundHover },
  },
  popover: { display: "flex", flexWrap: "wrap", gap: "6px", maxWidth: "300px", padding: "10px" },
  badge: {
    display: "inline-flex",
    alignItems: "center",
    columnGap: "4px",
    height: "20px",
    padding: "0 6px",
    borderRadius: "4px",
    color: "#fff",
    fontSize: "10.5px",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    lineHeight: 1,
    whiteSpace: "nowrap",
  },
  status: {
    display: "inline-flex",
    alignItems: "center",
    columnGap: "6px",
    height: "24px",
    padding: "0 12px",
    boxSizing: "border-box",
    borderRadius: "999px",
    fontSize: "11px",
    fontWeight: 600,
    lineHeight: 1,
    whiteSpace: "nowrap",
    "& svg": { flexShrink: 0 },
  },
  // Brand-blue pill — StatusLabel's shape without the leading icon.
  label: {
    display: "inline-flex",
    alignItems: "center",
    columnGap: "6px",
    height: "24px",
    padding: "0 10px",
    boxSizing: "border-box",
    maxWidth: "100%",
    borderRadius: "999px",
    border: "none",
    backgroundColor: CB.labelBg,
    color: CB.brandPressed,
    fontFamily: "inherit",
    fontSize: "11px",
    fontWeight: 600,
    lineHeight: 1,
    "& svg": { flexShrink: 0 },
  },
  // Hyperlink label = label + leading link icon, clickable.
  labelButton: {
    cursor: "pointer",
    ":hover": { backgroundColor: CB.labelBgHover },
    ":focus-visible": { outline: `2px solid ${CB.brand}`, outlineOffset: "2px" },
  },
  // Long values ellipsize inside the pill instead of stretching the column.
  labelText: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  itemName: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "4px 8px",
    fontWeight: tokens.fontWeightSemibold,
  },
});

/** Tinted pill with its icon: where a record *stands* (§8). Own column. */
export const StatusLabel: React.FC<{ kind: StatusKind; children: React.ReactNode }> = ({ kind, children }) => {
  const s = useTagStyles();
  const { bg, fg, Icon } = STATUS[kind];
  return (
    <span className={s.status} style={{ backgroundColor: bg, color: fg }}>
      <Icon />
      {children}
    </span>
  );
};

/**
 * Label: brand-blue pill with no icon — what a record *is*, as plain text.
 * `title` shows the full text when it ellipsizes.
 */
export const TagLabel: React.FC<{ children: React.ReactNode; title?: string }> = ({ children, title }) => {
  const s = useTagStyles();
  return (
    <span className={s.label} title={title}>
      <span className={s.labelText}>{children}</span>
    </span>
  );
};

/**
 * Hyperlink label: the Label with a leading link icon, clickable. It always
 * opens the related record in a NEW TAB — the caller passes
 * `openInNewWindow: true` to `navigation.openForm` (the icon promises it).
 */
export const HyperlinkLabel: React.FC<{
  children: React.ReactNode;
  onClick: () => void;
  title?: string;
}> = ({ children, onClick, title }) => {
  const s = useTagStyles();
  return (
    <button
      type="button"
      className={mergeClasses(s.label, s.labelButton)}
      title={title}
      aria-label={title ? `${title} (opens in a new tab)` : undefined}
      onClick={onClick}
    >
      <LinkIcon />
      <span className={s.labelText}>{children}</span>
    </button>
  );
};

export interface ChipData {
  type: string;
  label: string;
  value: string;
}

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
      {visible.map((c) => (
        <Chip key={c.type} {...c} />
      ))}
      {rest.length > 0 && (
        // inline keeps the surface inside this control's FluentProvider (theme vars)
        <Popover positioning="below-start" inline>
          <PopoverTrigger disableButtonEnhancement>
            <button type="button" className={s.more} aria-label={`${rest.length} more attributes`}>
              +{rest.length}
            </button>
          </PopoverTrigger>
          <PopoverSurface className={s.popover} aria-label="More attributes">
            {rest.map((c) => (
              <Chip key={c.type} {...c} />
            ))}
          </PopoverSurface>
        </Popover>
      )}
    </div>
  );
};

// ─── Note cell: capped preview + modal (long free text in a table) ──────────

/**
 * Element inside the control's <FluentProvider> that modals mount into.
 * Fluent portals to <body> by default, outside the provider, so the surface and
 * backdrop lose the theme's CSS variables and render transparent. The grid
 * provides this; with no provider the modal falls back to <body>.
 */
export const PortalRootContext = React.createContext<HTMLElement | null>(null);

// Above the grid's sticky header/totals cells (z-index 2) and the form chrome.
const MODAL_Z = 1000000;

const useNoteStyles = makeStyles({
  // 120 x 50 cap; the whole box is the click target.
  cell: { position: "relative", display: "block", width: "120px", height: "50px", cursor: "pointer" },
  preview: {
    boxSizing: "border-box",
    width: "100%",
    height: "100%",
    minHeight: 0,
    maxHeight: "50px",
    cursor: "pointer",
    ":hover": { ...shorthands.borderColor(CB.inputHover) },
    "& textarea": {
      height: "100%",
      minHeight: 0,
      maxHeight: "none",
      cursor: "pointer",
      fontSize: "11px",
      lineHeight: 1,
      overflow: "hidden", // read-only preview: the modal is where you read it all
      resize: "none",
      padding: "4px 6px",
    },
  },
  previewEditable: { backgroundColor: CB.inputFill, ":hover": { backgroundColor: "#fff" } },
  // Bottom-right brand-blue rounded square holding a white icon.
  corner: {
    position: "absolute",
    right: "4px",
    bottom: "4px",
    width: "20px",
    height: "20px",
    padding: 0,
    border: "none",
    borderRadius: "6px",
    backgroundColor: CB.brand,
    color: "#fff",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    ":hover": { backgroundColor: CB.brandHover },
    ":focus-visible": { outline: `2px solid ${CB.brandPressed}`, outlineOffset: "2px" },
  },
  // 480 x 300, 18px padding. No dimming: a drop shadow lifts it off the form instead.
  surface: {
    width: "480px",
    height: "300px",
    maxWidth: "calc(100vw - 32px)",
    maxHeight: "calc(100vh - 32px)",
    padding: "18px",
    zIndex: MODAL_Z,
    boxShadow: "0 12px 40px rgba(0, 0, 0, 0.30), 0 2px 8px rgba(0, 0, 0, 0.18)",
  },
  // Invisible but still there: it blocks the form behind the modal and gives
  // "click outside to close" something to catch.
  backdrop: { backgroundColor: "transparent", zIndex: MODAL_Z },
  body: { height: "100%", maxHeight: "none" },
  modalTitle: { fontSize: "15px", lineHeight: "20px", fontWeight: 600 },
  modalContent: { display: "flex", flexDirection: "column", minHeight: 0 },
  modalText: {
    display: "flex",
    flexGrow: 1,
    width: "100%",
    minHeight: "120px",
    backgroundColor: "#fff", // read-only: white
    "& textarea": { flexGrow: 1, minHeight: "120px", fontSize: "13px", padding: "0.5rem" },
  },
  modalTextEditable: { backgroundColor: CB.inputFill }, // editable: grey
  // DialogBody is a 3-column grid and DialogActions defaults to only its right
  // columns (~half the modal), which wrapped the buttons. Span the full row.
  modalActions: {
    gridColumnStart: 1,
    gridColumnEnd: -1,
    width: "100%",
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
  },
  // Its own line above the buttons.
  confirmText: { flexBasis: "100%", textAlign: "right", fontWeight: 600 },
});

/**
 * Long free text in a grid cell: a read-only 120x50 preview (11px, line-height
 * 1, no resize) that opens a modal on click. A bottom-right brand-blue button
 * says what the modal does — magnifier / "More" when the text is read-only,
 * pencil / "Edit" when it is editable. Closing the modal with unsaved edits
 * (Close, Esc or a backdrop click) asks first; Save commits and closes.
 */
export const NoteCell: React.FC<{
  value: string;
  /** Modal title, also used in the accessible names. */
  title: string;
  editable: boolean;
  onSave?: (value: string) => void;
}> = ({ value, title, editable, onSave }) => {
  const s = useNoteStyles();
  const portalRoot = React.useContext(PortalRootContext);
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState(value);
  const [confirming, setConfirming] = React.useState(false);
  const dirty = editable && draft !== value;

  const openModal = (): void => {
    setDraft(value);
    setConfirming(false);
    setOpen(true);
  };
  const close = (): void => {
    setOpen(false);
    setConfirming(false);
  };
  /** Close/Esc/backdrop: ask first when there are unsaved edits. */
  const requestClose = (): void => {
    if (confirming) return; // a stray click while asking: keep asking
    if (dirty) setConfirming(true);
    else close();
  };
  const save = (): void => {
    onSave?.(draft);
    close();
  };

  const actionLabel = editable ? "Edit" : "More";
  return (
    <>
      {/* Native title, not a Fluent Tooltip: that one portals to <body> outside the theme and renders transparent. */}
      <span className={s.cell} title={actionLabel} onClick={openModal}>
        <Textarea
          size="small"
          appearance="filled-lighter"
          className={mergeClasses(s.preview, editable && s.previewEditable)}
          readOnly
          tabIndex={-1}
          resize="none"
          value={value}
        />
        <button
          type="button"
          className={s.corner}
          aria-label={`${editable ? "Edit" : "View"} ${title}`}
          onClick={(e) => {
            e.stopPropagation(); // the wrapper's onClick would open it twice
            openModal();
          }}
        >
          {editable ? <EditIcon size={12} color="#fff" /> : <SearchIcon size={12} color="#fff" />}
        </button>
      </span>

      <Dialog
        open={open}
        onOpenChange={(_e, data) => {
          if (!data.open) requestClose();
        }}
      >
        <DialogSurface
          className={s.surface}
          backdrop={{ className: s.backdrop }}
          mountNode={portalRoot ?? undefined}
        >
          <DialogBody className={s.body}>
            <DialogTitle className={s.modalTitle}>{title}</DialogTitle>
            <DialogContent className={s.modalContent}>
              <Textarea
                appearance="outline"
                className={mergeClasses(s.modalText, editable && s.modalTextEditable)}
                readOnly={!editable}
                resize="none"
                value={draft}
                onChange={(_e, data) => setDraft(data.value)}
                textarea={{ "aria-label": title }}
              />
            </DialogContent>
            <DialogActions className={s.modalActions}>
              {confirming ? (
                <>
                  <span className={s.confirmText}>Close without saving your changes?</span>
                  <Button appearance="secondary" onClick={() => setConfirming(false)}>
                    Keep editing
                  </Button>
                  <Button appearance="primary" onClick={close}>
                    Close without saving
                  </Button>
                </>
              ) : (
                <>
                  {editable && (
                    <Button appearance="primary" disabled={!dirty} onClick={save}>
                      Save
                    </Button>
                  )}
                  <Button appearance="secondary" onClick={requestClose}>
                    Close
                  </Button>
                </>
              )}
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </>
  );
};

export type ActionResult = "saving" | "saved" | "error";

/** Item name + the action-result badge inline after it (spinner while saving). */
export const ItemName: React.FC<{ name: React.ReactNode; result?: ActionResult }> = ({ name, result }) => {
  const s = useTagStyles();
  return (
    <div className={s.itemName}>
      <span>{name}</span>
      {result === "saving" && <Spinner size="extra-tiny" aria-label="Saving" />}
      {result === "saved" && (
        <span className={s.badge} style={{ backgroundColor: CB.badgeSaved }}>
          <BadgeCheckIcon />
          Saved
        </span>
      )}
      {result === "error" && (
        <Tooltip content="Save failed — re-check the value" relationship="description">
          <span className={s.badge} style={{ backgroundColor: CB.badgeError }} tabIndex={0}>
            <BadgeAlertIcon />
            Error
          </span>
        </Tooltip>
      )}
    </div>
  );
};
