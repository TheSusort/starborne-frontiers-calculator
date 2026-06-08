import React from 'react';
import { BuffRow } from '../ui/BuffRow';
import { HealingSimulationResult } from '../../utils/calculators/healingEngineAdapter';

interface EnemyEffectsOverviewProps {
    /** The config whose round timeline to surface (typically the best config). */
    result: HealingSimulationResult;
    /** Number of rounds simulated (rows are clamped to the available round data). */
    rounds: number;
    /** Resolves an enemy attacker's id to its display name (ship name or its manual label,
     *  e.g. "Enemy 1"). Falls back to the raw id if the lookup is missing. */
    enemyName: (enemyId: string) => string;
}

/**
 * Per-round overview of the enemy attackers' effects in healing mode, ATTRIBUTED to the
 * source enemy ship: each enemy that acted gets a sub-header (its ship name / manual label)
 * with its own self-buffs and the debuffs/DoTs it landed on the heal target underneath.
 * Reuses the shared BuffRow status primitive (same visual language as the DPS round overview).
 * Names only — never folded into any sim value.
 */
export const EnemyEffectsOverview: React.FC<EnemyEffectsOverviewProps> = ({
    result,
    rounds,
    enemyName,
}) => {
    const count = Math.min(rounds, result.rounds.length);

    return (
        <div className="card !p-0 overflow-hidden">
            <div className="bg-dark-lighter px-2.5 py-1.5 text-xs font-semibold text-theme-text-secondary uppercase tracking-wide">
                Enemy Effects by Round
            </div>
            <div className="max-h-72 overflow-y-auto">
                {Array.from({ length: count }, (_, i) => {
                    const rd = result.rounds[i];
                    const enemyEffects = (rd.enemyEffects ?? []).filter(
                        (e) => e.selfBuffs.length > 0 || e.debuffs.length > 0
                    );
                    const isEmpty = enemyEffects.length === 0;
                    return (
                        <div
                            key={rd.round}
                            className="px-2.5 py-2 border-b border-dark-border last:border-b-0"
                        >
                            <div className="text-xs font-semibold uppercase tracking-wide mb-1.5 text-theme-text-secondary">
                                Round {rd.round}
                            </div>
                            {enemyEffects.map((enemy) => (
                                <div key={enemy.enemyId} className="mb-2 last:mb-0">
                                    <div className="text-xs font-semibold text-theme-text-primary mb-1">
                                        {enemyName(enemy.enemyId)}
                                    </div>
                                    {enemy.selfBuffs.length > 0 && (
                                        <>
                                            <div className="text-xs text-theme-text-secondary mb-1">
                                                Self-Buffs
                                            </div>
                                            {enemy.selfBuffs.map((b, j) => (
                                                <BuffRow
                                                    key={`eself-${b.buffName}-${j}`}
                                                    buff={b}
                                                    variant="self"
                                                />
                                            ))}
                                        </>
                                    )}
                                    {enemy.debuffs.length > 0 && (
                                        <>
                                            <div className="text-xs text-theme-text-secondary mt-1 mb-1">
                                                Debuffs on Target
                                            </div>
                                            {enemy.debuffs.map((b, j) => (
                                                <BuffRow
                                                    key={`tdeb-${b.buffName}-${j}`}
                                                    buff={b}
                                                    variant="enemy"
                                                />
                                            ))}
                                        </>
                                    )}
                                </div>
                            ))}
                            {isEmpty && (
                                <p className="text-xs text-dark-border italic">
                                    No enemy effects this round
                                </p>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
