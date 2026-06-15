import React from 'react';
import { StatCard } from '../ui/StatCard';
import { BattleRound, BattleResult } from '../../utils/calculators/battleSimulator';
import { LOW_HP_PCT, fmt } from '../../utils/simulator/boardOverlays';

interface ShipRoundCardProps {
    /** The pinned ship's actorId (synthetic roster id). */
    actorId: string;
    /** The current round being viewed. */
    round: BattleRound;
    /** Roster (for the ship name). */
    roster: BattleResult['roster'];
}

/**
 * Pinned per-ship detail for the current round: name + this-round stats via StatCard, plus
 * active buffs/debuffs. Reads the ship's state out of `round.ships` by actorId.
 *
 * NOTE: `activeDebuffs` is infliction-only — PR1's BattleResult surface carries no
 * `debuff-expired` event, so once a debuff is inflicted it accumulates and persists for the
 * rest of the battle. This is expected (asymmetric with buffs, which DO expire), not a bug.
 */
const ShipRoundCard: React.FC<ShipRoundCardProps> = ({ actorId, round, roster }) => {
    const entry = roster.find((r) => r.actorId === actorId);
    const state = round.ships.find((s) => s.actorId === actorId);

    if (!entry || !state) return null;

    return (
        <div className="card space-y-3">
            <div>
                <h3 className="text-lg font-semibold">{entry.name}</h3>
                <p className="text-sm text-theme-text-secondary">
                    {entry.side === 'player' ? 'Your team' : 'Enemy team'} - round {round.round}
                    {!state.alive && ' - destroyed'}
                </p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <StatCard
                    title="HP"
                    value={`${Math.round(state.hpPct)}%`}
                    color={state.hpPct < LOW_HP_PCT ? 'red' : 'green'}
                />
                <StatCard title="Damage dealt" value={fmt(state.damageDealt)} color="orange" />
                <StatCard title="Damage taken" value={fmt(state.damageTaken)} color="red" />
                <StatCard title="Healing done" value={fmt(state.healingDone)} color="green" />
                <StatCard
                    title="Healing received"
                    value={fmt(state.healingReceived)}
                    color="green"
                />
                <StatCard
                    title="Shields absorbed"
                    value={fmt(state.shieldsAbsorbed)}
                    color="blue"
                />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                    <div className="text-sm text-theme-text-secondary mb-1">Active buffs</div>
                    {state.activeBuffs.length > 0 ? (
                        <ul className="text-sm text-green-400 list-disc list-inside">
                            {state.activeBuffs.map((b, i) => (
                                <li key={`${b}-${i}`}>{b}</li>
                            ))}
                        </ul>
                    ) : (
                        <p className="text-sm text-theme-text-secondary">None</p>
                    )}
                </div>
                <div>
                    <div className="text-sm text-theme-text-secondary mb-1">Active debuffs</div>
                    {state.activeDebuffs.length > 0 ? (
                        <ul className="text-sm text-red-400 list-disc list-inside">
                            {state.activeDebuffs.map((d, i) => (
                                <li key={`${d}-${i}`}>{d}</li>
                            ))}
                        </ul>
                    ) : (
                        <p className="text-sm text-theme-text-secondary">None</p>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ShipRoundCard;
