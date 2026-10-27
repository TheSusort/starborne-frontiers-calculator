import React from 'react';

export type HitKind = 'damage' | 'miss' | 'heal' | 'shield';

/** One number that pops over a ship. */
export interface FloatingHit {
    kind: HitKind;
    /** 0 for a miss. */
    amount: number;
    crit: boolean;
}

/** Numbers shown per ship per turn; a multi-hit turn shows only its first ones. */
const MAX_FLOATS = 4;

const NUMBER = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

const hitText = (hit: FloatingHit) => {
    switch (hit.kind) {
        case 'miss':
            return 'MISS';
        case 'damage':
            return `${NUMBER.format(hit.amount)}${hit.crit ? '!' : ''}`;
        case 'heal':
        case 'shield':
            return `+${NUMBER.format(hit.amount)}`;
    }
};

/** `small` sizes the numbers for a hex board cell. */
const hitClass = (hit: FloatingHit, small: boolean) => {
    switch (hit.kind) {
        case 'miss':
            return `${small ? 'text-[10px]' : 'text-sm'} font-semibold text-theme-text-secondary`;
        case 'damage':
            return hit.crit
                ? `${small ? 'text-sm sm:text-base' : 'text-2xl'} font-extrabold text-yellow-300`
                : `${small ? 'text-xs sm:text-sm' : 'text-lg'} font-bold text-white`;
        case 'heal':
            return `${small ? 'text-xs' : 'text-base'} font-bold text-green-400`;
        case 'shield':
            return `${small ? 'text-xs' : 'text-base'} font-bold text-sky-300`;
    }
};

/** One turn's numbers rising off a ship (`.arcade-duel-float`; reduced motion keeps only the
 *  fade). Key it by the turn so a new turn mounts fresh ones. Place it in a positioned box. */
export const FloatingHits: React.FC<{
    turn: number | string;
    hits: readonly FloatingHit[];
    small?: boolean;
}> = ({ turn, hits, small = false }) => (
    <>
        {hits.slice(0, MAX_FLOATS).map((hit, i) => (
            <span
                key={`${turn}-${i}`}
                data-testid="duel-hit"
                className={`arcade-duel-float absolute whitespace-nowrap drop-shadow ${hitClass(hit, small)}`}
                style={{
                    left: `${50 + (i % 2 === 0 ? 1 : -1) * Math.ceil(i / 2) * 18}%`,
                    top: `${35 - i * 8}%`,
                    animationDelay: `${i * 90}ms`,
                }}
            >
                {hitText(hit)}
            </span>
        ))}
    </>
);
