import React from 'react';
import { Position } from '../../types/encounters';
import { CellOverlay, LOW_HP_PCT, fmt } from '../../utils/simulator/boardOverlays';
import { ChevronLeftIcon, ChevronRightIcon } from '../ui/icons';

interface BattleBoardProps {
    /** Side heading (e.g. "Your Team", "Enemy Team"). */
    title: string;
    /** Per-position overlays for the current round (from `overlaysForRound`). */
    overlays: Partial<Record<Position, CellOverlay>>;
    /** Enemy board mirrors columns (col 4 = front, nearest the player). */
    mirrored?: boolean;
    /** Currently pinned actorId (highlights its cell), or null. */
    pinnedActorId?: string | null;
    /** Click a cell → pin that ship for the detail card. */
    onPinShip: (actorId: string) => void;
}

const ROWS: Array<'T' | 'M' | 'B'> = ['T', 'M', 'B'];
const COLS = [1, 2, 3, 4];

/**
 * Read-only playback board: a side's 3×4 grid with per-cell overlays. Deliberately NOT a
 * reuse of the interactive FormationGrid (which resolves ships by raw shipId via useShips —
 * those won't match the synthetic roster actorIds). Cells are keyed off the overlays map
 * (position → CellOverlay), so everything lines up with the roster's actorId↔position.
 */
const BattleBoard: React.FC<BattleBoardProps> = ({
    title,
    overlays,
    mirrored = false,
    pinnedActorId,
    onPinShip,
}) => {
    const cols = mirrored ? [...COLS].reverse() : COLS;

    return (
        <div className="card">
            <h2 className="text-lg font-semibold mb-2">{title}</h2>
            <div role="grid" aria-label={`${title} battle board`} className="flex flex-col gap-1">
                {ROWS.map((row) => (
                    <div key={row} role="row" className="grid grid-cols-4 gap-1">
                        {cols.map((col) => {
                            const position = `${row}${col}` as Position;
                            const overlay = overlays[position];

                            if (!overlay) {
                                return (
                                    <div
                                        key={position}
                                        role="gridcell"
                                        aria-label={`${position} empty`}
                                        className="min-h-[3.5rem] border border-dashed border-dark-border rounded opacity-30"
                                    />
                                );
                            }

                            const pinned = pinnedActorId === overlay.actorId;
                            const hpClass =
                                overlay.hpPct < LOW_HP_PCT ? 'bg-red-500' : 'bg-green-500';
                            const shieldLabel =
                                overlay.currentShieldPool > 0
                                    ? `, ${fmt(overlay.currentShieldPool)} shield`
                                    : '';

                            return (
                                <button
                                    key={position}
                                    type="button"
                                    role="gridcell"
                                    onClick={() => onPinShip(overlay.actorId)}
                                    aria-label={`${overlay.name} at ${position}, ${Math.round(overlay.hpPct)}% HP${shieldLabel}${overlay.alive ? '' : ', destroyed'}`}
                                    aria-pressed={pinned}
                                    className={`min-h-[3.5rem] p-1 text-left border rounded transition-colors ${
                                        pinned
                                            ? 'border-primary'
                                            : 'border-dark-border hover:border-primary'
                                    } ${overlay.alive ? 'bg-dark' : 'bg-dark opacity-40 grayscale'}`}
                                >
                                    <div className="flex items-center justify-between gap-1 min-w-0">
                                        <span className="text-xs font-medium truncate">
                                            {overlay.name}
                                        </span>
                                        {overlay.effect === 'damage' && (
                                            <span
                                                className="text-[10px] text-red-400 shrink-0"
                                                aria-label="took damage"
                                            >
                                                -dmg
                                            </span>
                                        )}
                                        {overlay.effect === 'heal' && (
                                            <span
                                                className="text-[10px] text-green-400 shrink-0"
                                                aria-label="healed"
                                            >
                                                +heal
                                            </span>
                                        )}
                                        {overlay.effect === 'shield' && (
                                            <span
                                                className="text-[10px] text-blue-400 shrink-0"
                                                aria-label="shield absorbed"
                                            >
                                                shield
                                            </span>
                                        )}
                                    </div>
                                    <div className="mt-1 h-1.5 w-full bg-dark-border rounded overflow-hidden">
                                        <div
                                            className={`h-full ${hpClass}`}
                                            style={{ width: `${overlay.hpPct}%` }}
                                            data-testid={`hp-bar-${position}`}
                                        />
                                    </div>
                                    {overlay.currentShieldPool > 0 && (
                                        <div
                                            className="text-[10px] text-blue-400 mt-0.5 truncate"
                                            aria-label={`${fmt(overlay.currentShieldPool)} shield remaining`}
                                        >
                                            {fmt(overlay.currentShieldPool)} shield
                                        </div>
                                    )}
                                    {!overlay.alive && (
                                        <div className="text-[10px] text-theme-text-secondary mt-0.5">
                                            destroyed
                                        </div>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                ))}
            </div>
            <div
                className={`flex items-center gap-1 text-[0.65rem] uppercase tracking-wide text-theme-text-secondary mt-2 ${
                    mirrored ? 'justify-start' : 'justify-end'
                }`}
                aria-label="front line faces the opposing team"
            >
                {mirrored ? (
                    <>
                        <ChevronLeftIcon className="w-3 h-3" />
                        <span>front</span>
                    </>
                ) : (
                    <>
                        <span>front</span>
                        <ChevronRightIcon className="w-3 h-3" />
                    </>
                )}
            </div>
        </div>
    );
};

export default BattleBoard;
