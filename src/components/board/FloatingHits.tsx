import React from 'react';

export type HitKind = 'damage' | 'miss' | 'heal' | 'shield' | 'buff' | 'debuff' | 'resisted';

/** One number that pops over a ship. */
export interface FloatingHit {
    kind: HitKind;
    /** 0 for a miss. */
    amount: number;
    crit: boolean;
    /** The status a `buff` or `debuff` hit names. */
    label?: string;
}

/** Numbers shown per ship per turn; a multi-hit turn shows only its first ones. */
const MAX_FLOATS = 4;
/** Status texts shown per ship per turn, counted apart from the numbers. */
const MAX_STATUS_FLOATS = 3;

const isStatus = (hit: FloatingHit) =>
    hit.kind === 'buff' || hit.kind === 'debuff' || hit.kind === 'resisted';

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
        case 'buff':
            return `▲ ${hit.label ?? ''}`;
        case 'debuff':
            return `▼ ${hit.label ?? ''}`;
        case 'resisted':
            return 'RESISTED';
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
        case 'buff':
            return `${small ? 'text-[10px]' : 'text-sm'} font-semibold text-green-400`;
        case 'debuff':
            return `${small ? 'text-[10px]' : 'text-sm'} font-semibold text-red-400`;
        case 'resisted':
            return `${small ? 'text-[10px]' : 'text-sm'} font-semibold text-theme-text-secondary`;
    }
};

/** One turn's numbers rising off a ship (`.board-float`; reduced motion keeps only the
 *  fade), with its status texts (a buff, a debuff, a resist) stacked above them, newest on top.
 *  Key it by the turn so a new turn mounts fresh ones. Place it in a positioned box. */
export const FloatingHits: React.FC<{
    turn: number | string;
    hits: readonly FloatingHit[];
    small?: boolean;
}> = ({ turn, hits, small = false }) => {
    const statuses = hits.filter(isStatus).slice(0, MAX_STATUS_FLOATS).reverse();
    const numbers = hits.filter((hit) => !isStatus(hit)).slice(0, MAX_FLOATS);
    return (
        <>
            {statuses.length > 0 && (
                <div className="absolute inset-x-0 top-[2%] flex flex-col items-center">
                    {statuses.map((hit, i) => (
                        <span
                            key={`${turn}-s${i}`}
                            data-testid="status-float"
                            className={`board-float whitespace-nowrap drop-shadow ${hitClass(hit, small)}`}
                        >
                            {hitText(hit)}
                        </span>
                    ))}
                </div>
            )}
            {numbers.map((hit, i) => (
                <span
                    key={`${turn}-${i}`}
                    data-testid="duel-hit"
                    className={`board-float absolute whitespace-nowrap drop-shadow ${hitClass(hit, small)}`}
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
};
