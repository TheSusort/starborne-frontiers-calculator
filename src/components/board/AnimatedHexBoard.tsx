import React from 'react';
import type { Position } from '../../types/encounters';
import { ChipRow } from '../ui/ChipRow';
import { HexTile } from '../ui/HexTile';
import { MeterBar } from '../ui/MeterBar';
import { FloatingHits, type FloatingHit } from './FloatingHits';
import { hexBoardLayout } from './hexBoardLayout';

/** What one occupied cell shows at the current moment of a playback. */
export interface HexBoardShip {
    name: string;
    imageUrl: string | null;
    /** The image already faces the other side, so a mirrored board never flips it. */
    facesOpponent?: boolean;
    hpPct: number;
    /** The shield pool as a percentage of max HP, 0..100. */
    shieldPct: number;
    /** Charged-skill fill, 0..100; `null` hides the charge bar. */
    chargePct: number | null;
    buffs: readonly string[];
    debuffs: readonly string[];
    /** A destroyed ship is drawn faded. */
    alive: boolean;
    /** The ship whose turn is playing: its rim is highlighted. */
    acting?: boolean;
    /** Numbers still floating over the ship, one group per turn, keyed by that turn. */
    floats?: readonly { turn: number | string; hits: readonly FloatingHit[] }[];
    /** Set while the ship has just been struck: a flash over the hex, keyed so each strike
     *  replays it. */
    flash?: number | string | null;
    /** A banner over the cell (a charged skill), keyed so each one replays its entrance;
     *  `short` is shown at phone width. */
    banner?: { key: number | string; text: string; short: string } | null;
}

const hpFill = (hp: number) => (hp < 30 ? 'bg-red-500' : 'bg-green-500');

const TONE_RIM: Record<'player' | 'enemy', string> = {
    player: 'bg-sky-500/70',
    enemy: 'bg-red-500/70',
};

const ShipCell: React.FC<{
    ship: HexBoardShip;
    mirrored: boolean;
    tone: 'player' | 'enemy';
}> = ({ ship, mirrored, tone }) => {
    const { hpPct: hp, shieldPct: shield, chargePct } = ship;
    return (
        <>
            <HexTile
                rimClassName={ship.acting ? 'bg-primary' : TONE_RIM[tone]}
                className={ship.alive ? '' : 'opacity-40 grayscale'}
            >
                <div className="absolute inset-x-[8%] top-[10%] bottom-[38%] flex items-center justify-center">
                    {ship.imageUrl ? (
                        <img
                            src={ship.imageUrl}
                            alt={ship.name}
                            className={`max-h-full max-w-full object-contain ${mirrored && !ship.facesOpponent ? '-scale-x-100' : ''}`}
                        />
                    ) : (
                        <span className="truncate text-[9px] font-semibold text-theme-text-secondary sm:text-xs">
                            {ship.name}
                        </span>
                    )}
                </div>
                <div className="absolute inset-x-[14%] top-[64%] space-y-px">
                    <MeterBar
                        percentage={hp}
                        label={`${ship.name} hull`}
                        fillClassName={hpFill(hp)}
                        className="!h-1 sm:!h-1.5 !rounded-none"
                    />
                    <div className={shield > 0 ? '' : 'invisible'}>
                        <MeterBar
                            percentage={shield}
                            label={`${ship.name} shield`}
                            fillClassName="bg-sky-400"
                            className="!h-0.5 sm:!h-1 !rounded-none"
                        />
                    </div>
                    <div className={chargePct !== null ? '' : 'invisible'}>
                        <MeterBar
                            percentage={chargePct ?? 0}
                            label={`${ship.name} charge`}
                            fillClassName="bg-primary"
                            className="!h-0.5 sm:!h-1 !rounded-none"
                        />
                    </div>
                </div>
                {ship.flash != null && (
                    <div
                        key={ship.flash}
                        className="board-hit-flash absolute inset-0 bg-white"
                        aria-hidden="true"
                    />
                )}
            </HexTile>
            <div className="pointer-events-none absolute inset-x-0 top-[2%] flex justify-center gap-px">
                <ChipRow items={ship.buffs} label={`${ship.name} buffs`} max={0} variant="buff" />
                <ChipRow
                    items={ship.debuffs}
                    label={`${ship.name} debuffs`}
                    max={0}
                    variant="debuff"
                />
            </div>
            <div className="pointer-events-none absolute inset-0" aria-hidden="true">
                {ship.floats?.map((f) => (
                    <FloatingHits key={f.turn} turn={f.turn} hits={f.hits} small />
                ))}
            </div>
            {ship.banner && (
                <div
                    key={ship.banner.key}
                    role="status"
                    aria-label={`${ship.name} ${ship.banner.text}`}
                    className="arcade-duel-charged absolute inset-x-[-10%] top-[40%] truncate border border-primary/70 bg-primary/30 px-0.5 text-center text-[9px] font-bold tracking-wider text-primary sm:text-[10px]"
                >
                    <span className="sm:hidden">{ship.banner.short}</span>
                    <span className="hidden sm:inline">{ship.banner.text}</span>
                </div>
            )}
        </>
    );
};

interface AnimatedHexBoardProps {
    /** The cells drawn, e.g. `ALL_POSITIONS` or `SMALL_GRID_POSITIONS`. */
    cells: readonly Position[];
    /** What each occupied cell shows; a cell without an entry is a faint empty hex. */
    ships: Partial<Record<Position, HexBoardShip>>;
    /** Puts the front column (4) on the left, for the side on the right of the screen. */
    mirrored?: boolean;
    /** The rim colour of an occupied cell that is not acting. */
    tone: 'player' | 'enemy';
    /** Accessible name of the board. */
    label: string;
    className?: string;
}

/**
 * One side's hex board during a fight playback: `cells` laid out as on the real board, each
 * occupied cell showing its ship's image, hull, shield and charge bars inside the hex, buff and
 * debuff counts (names in the tooltip), and over it the floating numbers, a hit flash and a
 * banner. The caller drives the playback by re-rendering with each moment's `ships`; the board
 * holds no timing of its own. It fills its width and keeps the board's aspect ratio.
 */
export const AnimatedHexBoard: React.FC<AnimatedHexBoardProps> = ({
    cells,
    ships,
    mirrored = false,
    tone,
    label,
    className = '',
}) => {
    const layout = hexBoardLayout(cells);
    return (
        <div
            role="group"
            aria-label={label}
            className={`relative ${className}`}
            style={{ aspectRatio: layout.aspectRatio }}
        >
            {cells.map((cell) => {
                const b = layout.box(cell, mirrored);
                const ship = ships[cell];
                return (
                    <div
                        key={cell}
                        data-cell={cell}
                        className="absolute"
                        style={{
                            left: `${b.left}%`,
                            top: `${b.top}%`,
                            width: `${b.width}%`,
                            height: `${b.height}%`,
                        }}
                    >
                        {ship ? (
                            <ShipCell ship={ship} mirrored={mirrored} tone={tone} />
                        ) : (
                            <HexTile rimClassName="bg-dark-border/50" faceClassName="bg-dark/60" />
                        )}
                    </div>
                );
            })}
        </div>
    );
};
