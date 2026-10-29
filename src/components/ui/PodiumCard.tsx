import React from 'react';
import { TrophyIcon } from './icons';

/** One place on a top-three podium: a trophy and a glowing rank numeral in the medal colour
 *  over a medal-tinted card. `raised` makes the card taller and its numeral larger (first
 *  place). The badge slot keeps its height when empty so neighbouring cards line up.
 *  `accentColor` must be a 6-digit hex colour: the tint, border and glow append alpha
 *  digits to it, which is why they are inline styles. */
interface PodiumCardProps {
    rank: number;
    title: string;
    value: string;
    accentColor: string;
    raised?: boolean;
    badge?: React.ReactNode;
    /** Shown under the title in a fixed-height slot. Pass null to hold the slot empty so a
     *  card without one still lines up with its neighbours; undefined omits the slot. */
    subtitle?: React.ReactNode;
    /** A smaller secondary line under the value. */
    detail?: string;
}

export const PodiumCard: React.FC<PodiumCardProps> = ({
    rank,
    title,
    value,
    accentColor,
    raised = false,
    badge,
    subtitle,
    detail,
}) => (
    <div
        className={`card flex min-w-0 flex-col items-center justify-end gap-1 px-2 text-center ${
            raised ? 'min-h-[11.5rem] pb-3 pt-5' : 'min-h-[9rem] pb-3 pt-4'
        }`}
        style={{
            background: `linear-gradient(to bottom, ${accentColor}38 0%, ${accentColor}0f 55%, rgb(var(--color-bg)) 100%)`,
            borderColor: `${accentColor}66`,
            boxShadow: `0 0 ${raised ? 20 : 10}px ${accentColor}${raised ? '40' : '24'}`,
        }}
    >
        <TrophyIcon className={raised ? 'w-7 h-7' : 'w-5 h-5'} style={{ color: accentColor }} />
        <span
            className={`font-bold leading-none tabular-nums ${raised ? 'text-4xl' : 'text-3xl'}`}
            style={{
                color: accentColor,
                textShadow: `0 0 6px ${accentColor}cc, 0 0 18px ${accentColor}80`,
            }}
        >
            #{rank}
        </span>
        <span
            className="mt-1 block w-full truncate text-sm font-semibold text-theme-text"
            title={title}
        >
            {title}
        </span>
        {subtitle !== undefined && (
            <span className="flex h-5 w-full min-w-0 items-center justify-center">{subtitle}</span>
        )}
        <span className="text-sm tabular-nums text-theme-text-secondary">{value}</span>
        {detail && (
            <span className="max-w-full break-words text-xs tabular-nums text-theme-text-secondary">
                {detail}
            </span>
        )}
        <span className="flex h-5 items-center">{badge}</span>
    </div>
);
