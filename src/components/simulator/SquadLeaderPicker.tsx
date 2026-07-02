import React, { useMemo } from 'react';
import { Select } from '../ui/Select';
import { FACTIONS } from '../../constants/factions';
import { RARITIES } from '../../constants/rarities';
import { SQUAD_LEADERS, SquadLeaderEffect } from '../../constants/squadLeaders';
import {
    activeSquadLeaderEffects,
    isSquadLeaderEffectSimulated,
    squadLeaderEffectTargeting,
    SquadLeaderSelection,
} from '../../utils/combat/preFight';
import { Ship } from '../../types/ship';
import { BoardState } from './PlacementBoard';

/** Stage labels match SquadLeaderCard's STEP_LABELS. */
const STAGE_LABELS = ['I', 'II', 'III'] as const;
const STAGE_OPTIONS = STAGE_LABELS.map((label, i) => ({ value: String(i + 1), label }));

/** Stage a leader defaults to when first picked: III (maxed — the common case, and the
 *  only stage where legendary enemy debuffs exist, so the preview shows the full kit). */
const DEFAULT_STAGE = 3;

const factionLabel = (faction: string): string => FACTIONS[faction]?.name ?? faction;

interface PreviewLine {
    effect: SquadLeaderEffect;
    /** Who the effect lands on, e.g. "2 Marauders ships" / "all enemy ships". */
    targetLabel: string;
    enemySide: boolean;
    simulated: boolean;
}

interface Props {
    side: 'player' | 'enemy';
    /** The side's current selection; undefined = no leader. */
    selection: SquadLeaderSelection | undefined;
    onChange: (selection: SquadLeaderSelection | undefined) => void;
    /** The side's placement board (drives the applied-effects preview + faction gate). */
    board: BoardState;
}

/**
 * Per-side squad-leader picker for the Combat Simulator: Faction (+None) → Leader →
 * Stage selects, plus an applied-effects preview resolved against the CURRENT board
 * via the same preFight targeting/classification helpers the sim pass uses.
 */
const SquadLeaderPicker: React.FC<Props> = ({ side, selection, onChange, board }) => {
    const ships = useMemo(
        () => Object.values(board).filter((ship): ship is Ship => ship !== undefined),
        [board]
    );

    const factionOptions = useMemo(
        () =>
            Object.keys(SQUAD_LEADERS).map((faction) => ({
                value: faction,
                label: factionLabel(faction),
            })),
        []
    );

    const leaderOptions = useMemo(() => {
        if (!selection) return [];
        return (SQUAD_LEADERS[selection.faction] ?? []).map((leader) => ({
            value: leader.name,
            label: `${leader.name} (${RARITIES[leader.rarity]?.label ?? leader.rarity})`,
        }));
    }, [selection]);

    const handleFactionChange = (faction: string) => {
        if (!faction) {
            onChange(undefined);
            return;
        }
        const leaders = SQUAD_LEADERS[faction];
        if (!leaders || leaders.length === 0) {
            onChange(undefined);
            return;
        }
        // Faction change resets the leader to the new faction's first (rare) leader so a
        // stale name can never pair with the wrong faction; the stage carries over.
        onChange({ faction, name: leaders[0].name, stage: selection?.stage ?? DEFAULT_STAGE });
    };

    const handleLeaderChange = (name: string) => {
        if (!selection || !name) return;
        onChange({ ...selection, name });
    };

    const handleStageChange = (stage: string) => {
        if (!selection) return;
        if (stage !== '1' && stage !== '2' && stage !== '3') return;
        onChange({ ...selection, stage: Number(stage) as 1 | 2 | 3 });
    };

    // Applied-effects preview: resolve the active effects against the current board with
    // the SAME targeting + classification rules as the sim's squadLeaderPass (imported
    // from the preFight module — never reimplemented here).
    const preview = useMemo(() => {
        if (!selection) return undefined;
        const leader = SQUAD_LEADERS[selection.faction]?.find((l) => l.name === selection.name);
        if (!leader) return undefined;
        const label = factionLabel(selection.faction);
        const gateMet = ships.some((ship) => ship.faction === selection.faction);
        const lines: PreviewLine[] = activeSquadLeaderEffects(leader, selection.stage).map(
            (effect) => {
                const targeting = squadLeaderEffectTargeting(effect, selection.faction, ships);
                const targetLabel =
                    targeting.scope === 'enemies'
                        ? 'all enemy ships'
                        : `${targeting.recipients.length} ${label} ship${
                              targeting.recipients.length === 1 ? '' : 's'
                          }`;
                return {
                    effect,
                    targetLabel,
                    enemySide: targeting.scope === 'enemies',
                    simulated: isSquadLeaderEffectSimulated(effect),
                };
            }
        );
        return { lines, gateMet, factionLabel: label };
    }, [selection, ships]);

    return (
        <div className="card space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-theme-text-secondary">
                Squad Leader
            </h3>
            <div className="flex flex-wrap gap-3">
                <Select
                    label="Faction"
                    noDefaultSelection
                    defaultOption="None"
                    value={selection?.faction ?? ''}
                    options={factionOptions}
                    onChange={handleFactionChange}
                    data-testid={`squad-leader-faction-${side}`}
                />
                <Select
                    label="Leader"
                    value={selection?.name ?? ''}
                    options={leaderOptions}
                    onChange={handleLeaderChange}
                    disabled={!selection}
                    data-testid={`squad-leader-name-${side}`}
                />
                <Select
                    label="Stage"
                    value={selection ? String(selection.stage) : ''}
                    options={STAGE_OPTIONS}
                    onChange={handleStageChange}
                    disabled={!selection}
                    data-testid={`squad-leader-stage-${side}`}
                />
            </div>
            {preview && (
                <div className="space-y-1">
                    {!preview.gateMet && (
                        <p className="text-sm text-amber-400">
                            No {preview.factionLabel} ship on this team — leader effects inactive
                            (enemy-targeting effects included).
                        </p>
                    )}
                    <ul className="space-y-1">
                        {preview.lines.map((line, index) => (
                            <li
                                key={index}
                                className={`text-sm ${
                                    // Gate unmet → nothing applies: dim every line. Otherwise
                                    // mirror SquadLeaderCard: ally = green, enemy = red.
                                    !preview.gateMet
                                        ? 'text-theme-text-secondary'
                                        : line.enemySide
                                          ? 'text-red-400'
                                          : 'text-green-400'
                                }`}
                            >
                                {line.effect.text}
                                <span className="text-theme-text-secondary">
                                    {' '}
                                    &rarr; {line.targetLabel}
                                </span>
                                {!line.simulated && (
                                    <span className="ml-2 align-middle text-xs uppercase tracking-wide px-1.5 py-0.5 border border-amber-500/40 text-amber-400">
                                        Not simulated
                                    </span>
                                )}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
};

export default SquadLeaderPicker;
