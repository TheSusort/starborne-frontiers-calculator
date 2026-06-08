import React from 'react';
import { BuffRow } from '../ui/BuffRow';
import { HealingSimulationResult } from '../../utils/calculators/healingEngineAdapter';

interface EnemyEffectsOverviewProps {
    /** The config whose round timeline to surface (typically the best config). */
    result: HealingSimulationResult;
    /** Number of rounds simulated (rows are clamped to the available round data). */
    rounds: number;
}

/**
 * Per-round overview of the enemy attackers' effects in healing mode: the self-buffs active
 * on the enemies and the debuffs/DoTs they landed on the heal target. Reuses the shared
 * BuffRow status primitive (same visual language as the DPS round overview). Names only —
 * never folded into any sim value.
 */
export const EnemyEffectsOverview: React.FC<EnemyEffectsOverviewProps> = ({ result, rounds }) => {
    const count = Math.min(rounds, result.rounds.length);

    return (
        <div className="card !p-0 overflow-hidden">
            <div className="bg-dark-lighter px-2.5 py-1.5 text-xs font-semibold text-theme-text-secondary uppercase tracking-wide">
                Enemy Effects by Round
            </div>
            <div className="max-h-72 overflow-y-auto">
                {Array.from({ length: count }, (_, i) => {
                    const rd = result.rounds[i];
                    const selfBuffs = rd.enemySelfBuffs ?? [];
                    const targetDebuffs = rd.targetDebuffs ?? [];
                    const isEmpty = selfBuffs.length === 0 && targetDebuffs.length === 0;
                    return (
                        <div
                            key={rd.round}
                            className="px-2.5 py-2 border-b border-dark-border last:border-b-0"
                        >
                            <div className="text-xs font-semibold uppercase tracking-wide mb-1.5 text-theme-text-secondary">
                                Round {rd.round}
                            </div>
                            {selfBuffs.length > 0 && (
                                <>
                                    <div className="text-xs text-theme-text-secondary mb-1">
                                        Enemy Self-Buffs
                                    </div>
                                    {selfBuffs.map((b, j) => (
                                        <BuffRow
                                            key={`eself-${b.buffName}-${j}`}
                                            buff={b}
                                            variant="self"
                                        />
                                    ))}
                                </>
                            )}
                            {targetDebuffs.length > 0 && (
                                <>
                                    <div className="text-xs text-theme-text-secondary mt-2 mb-1">
                                        Debuffs on Target
                                    </div>
                                    {targetDebuffs.map((b, j) => (
                                        <BuffRow
                                            key={`tdeb-${b.buffName}-${j}`}
                                            buff={b}
                                            variant="enemy"
                                        />
                                    ))}
                                </>
                            )}
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
