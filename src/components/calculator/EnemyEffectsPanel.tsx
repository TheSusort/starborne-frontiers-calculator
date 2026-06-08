import React from 'react';
import { BuffRow } from '../ui/BuffRow';
import { HealingRoundData } from '../../utils/calculators/healingEngineAdapter';

interface EnemyEffectsPanelProps {
    /** The hovered round's data, or null when nothing is hovered. */
    roundData: HealingRoundData | null;
    /** Total rounds simulated — shown in the header ("Round X of Y"). */
    totalRounds: number;
    /** 1-based hovered round number, or null. Gates the panel content. */
    hoveredRound: number | null;
    /** Resolves an enemy attacker's id to its display name (ship name or its manual label,
     *  e.g. "Enemy 1"). Falls back to the raw id if the lookup is missing. */
    enemyName: (enemyId: string) => string;
}

/**
 * Right-hand hover-gated panel of the enemy attackers' effects for the hovered round, ATTRIBUTED
 * to the source enemy ship: each enemy that acted gets a sub-header (its ship name / manual label)
 * with its own self-buffs and the debuffs/DoTs it landed on the heal target underneath. Mirrors
 * the DPS calculator's DPSBuffPanel structure — single round, gated on `hoveredRound`. Reuses the
 * shared BuffRow status primitive. Names only — never folded into any sim value.
 */
export const EnemyEffectsPanel: React.FC<EnemyEffectsPanelProps> = ({
    roundData,
    totalRounds,
    hoveredRound,
    enemyName,
}) => {
    const enemyEffects = (roundData?.enemyEffects ?? []).filter(
        (e) => e.selfBuffs.length > 0 || e.debuffs.length > 0
    );
    const isEmpty = enemyEffects.length === 0;

    return (
        <div className="w-48 flex-shrink-0 card !p-0 rounded overflow-hidden">
            <div className="bg-dark-lighter px-2.5 py-1.5 text-xs font-semibold text-theme-text-secondary uppercase tracking-wide">
                {hoveredRound != null ? `Round ${hoveredRound} of ${totalRounds}` : 'Hover a round'}
            </div>
            <div className="px-2.5 py-2">
                {hoveredRound == null ? (
                    <p className="text-xs text-dark-border italic">
                        Hover a round to see enemy effects
                    </p>
                ) : isEmpty ? (
                    <p className="text-xs text-dark-border italic">No enemy effects this round</p>
                ) : (
                    enemyEffects.map((enemy) => (
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
                    ))
                )}
            </div>
        </div>
    );
};
