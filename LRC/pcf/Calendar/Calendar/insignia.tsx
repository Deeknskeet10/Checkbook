import * as React from "react";
import { CAPTAIN_BARS, COLONEL_EAGLE, GOLD_OAK_LEAF, SILVER_OAK_LEAF } from "./insigniaData";

// lrc_LeadershipRoleRank choice values (0-16), per the Role - Rank Requirement
// Function doc: roles 0-7 (Action Officer .. CNGB), ranks 8-15 (O3 .. O10),
// 16 = Other. Insignia follow the doc: general-officer roles carry their
// equivalent grade's stars (G-3/5/7 = 1, DDARNG = 2, DARNG = 3, CNGB = 4) and
// ARNG G3 the O6 eagle; Action Officer / Branch Chief / Division Chief / Other
// have no insignia.
type Insignia = { kind: "img"; src: string; wide?: boolean } | { kind: "stars"; count: number };

interface RoleRankMeta {
    label: string; // short label for tiles / CSV
    full: string; // long name for tooltips / detail panel
    insignia: Insignia | null;
}

const img = (src: string, wide?: boolean): Insignia => ({ kind: "img", src, wide });
const stars = (count: number): Insignia => ({ kind: "stars", count });

export const ROLE_RANKS: Record<number, RoleRankMeta> = {
    0: { label: "AO", full: "Action Officer", insignia: null },
    1: { label: "Branch Chief", full: "Branch Chief", insignia: null },
    2: { label: "Division Chief", full: "Division Chief", insignia: null },
    3: { label: "ARNG G3", full: "ARNG G3", insignia: img(COLONEL_EAGLE, true) },
    4: { label: "ARNG G-3/5/7", full: "ARNG G-3/5/7", insignia: stars(1) },
    5: { label: "DDARNG", full: "Deputy Director Army National Guard", insignia: stars(2) },
    6: { label: "DARNG", full: "Director Army National Guard", insignia: stars(3) },
    7: { label: "CNGB", full: "Chief National Guard Bureau", insignia: stars(4) },
    8: { label: "O3", full: "O3 - Captain", insignia: img(CAPTAIN_BARS) },
    9: { label: "O4", full: "O4 - Major", insignia: img(GOLD_OAK_LEAF) },
    10: { label: "O5", full: "O5 - Lieutenant Colonel", insignia: img(SILVER_OAK_LEAF) },
    11: { label: "O6", full: "O6 - Colonel", insignia: img(COLONEL_EAGLE, true) },
    12: { label: "O7", full: "O7 - Brigadier General", insignia: stars(1) },
    13: { label: "O8", full: "O8 - Major General", insignia: stars(2) },
    14: { label: "O9", full: "O9 - Lieutenant General", insignia: stars(3) },
    15: { label: "O10", full: "O10 - General", insignia: stars(4) },
    16: { label: "Other", full: "Other", insignia: null },
};

export function roleRankMeta(value: number | null): RoleRankMeta | null {
    return value == null ? null : ROLE_RANKS[value] ?? null;
}

// Silver five-point star (point up) in a 16x16 box.
const STAR_POINTS =
    "8,1 9.65,5.73 14.66,5.84 10.66,8.87 12.11,13.66 8,10.8 3.89,13.66 5.34,8.87 1.34,5.84 6.35,5.73";

const Stars: React.FC<{ count: number; size: number }> = ({ count, size }) => (
    <svg
        width={count * size}
        height={size}
        viewBox={`0 0 ${count * 16} 16`}
        role="img"
        focusable="false"
    >
        {Array.from({ length: count }, (_, i) => (
            <g key={i} transform={`translate(${i * 16} 0)`}>
                <polygon points={STAR_POINTS} fill="#c3c9d1" stroke="#4d5259" strokeWidth="0.8" />
            </g>
        ))}
    </svg>
);

export interface RankBadgeProps {
    value: number | null;
    // Height of the badge chip in px.
    size?: number;
}

// Small white chip showing the insignia for a leadership role/rank value.
// Renders nothing for values with no insignia (AO, chiefs, Other) or unknown values.
export const RankBadge: React.FC<RankBadgeProps> = ({ value, size = 16 }) => {
    const meta = roleRankMeta(value);
    if (!meta?.insignia) return null;
    const inner = size - 4;
    return (
        <span className="cal__rank" style={{ height: size }} title={meta.full}>
            {meta.insignia.kind === "stars" ? (
                <Stars count={meta.insignia.count} size={inner} />
            ) : (
                <img
                    src={meta.insignia.src}
                    alt={meta.full}
                    style={{ height: meta.insignia.wide ? inner - 2 : inner, width: "auto" }}
                />
            )}
        </span>
    );
};
