import React from 'react';
import { BuffRow } from '../ui/BuffRow';
import { HealingRoundData } from '../../utils/calculators/healingEngineAdapter';
import { EnemyDoTState } from '../../utils/combat/engine';
import { ActiveBuff } from '../../utils/combat/statusEngine';
import { dotStateLabel } from './dotLabels';

/** One DoT status row: an orange marker dot + the shared DPS DoT label (`Inferno I ×3`). Keyed by
 *  the caller. Shared by the per-enemy DoT list and the aggregated Heal Target DoT list. The
 *  `resisted` variant dims the row and greys the marker + appends an italic "resisted" label,
 *  mirroring BuffRow's resisted treatment for a DoT that failed to land. */
const DotRow: React.FC<{ dot: EnemyDoTState; resisted?: boolean }> = ({ dot, resisted }) => (
    <div className={`flex items-center gap-1.5 mb-1 ${resisted ? 'opacity-40' : ''}`}>
        <div
            className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${resisted ? 'bg-dark-border' : 'bg-orange-500'}`}
        />
        <span className="flex-1 text-xs text-theme-text-primary truncate">
            {dotStateLabel(dot)}
        </span>
        {resisted && <span className="text-xs text-theme-text-secondary italic">resisted</span>}
    </div>
);

/** Treat 'permanent'/'recurring' as the longest possible duration so a persistent/recurring debuff
 *  always wins the dedup over any timed one of the same name. */
const turnsRank = (t: ActiveBuff['turnsRemaining']): number =>
    typeof t === 'number' ? t : Number.POSITIVE_INFINITY;

/** Dedup debuffs by buffName for the target-centric Heal Target roll-up, keeping the entry with the
 *  largest turnsRemaining (the same debuff landed by two enemies collapses to one row). */
const mergeTargetDebuffs = (debuffs: ActiveBuff[]): ActiveBuff[] => {
    const byName = new Map<string, ActiveBuff>();
    for (const b of debuffs) {
        const existing = byName.get(b.buffName);
        if (!existing || turnsRank(b.turnsRemaining) > turnsRank(existing.turnsRemaining)) {
            byName.set(b.buffName, b);
        }
    }
    return Array.from(byName.values());
};

/** Merge DoTs for the Heal Target roll-up by type+tier, summing stacks (matches the engine's
 *  `mergeDoTsForDisplay`/`buildEnemyRoundEffects` type+tier+sum-stacks semantics) so the same DoT
 *  type/tier applied by two enemies shows as one summed-stack row instead of two. */
const mergeTargetDots = (dots: EnemyDoTState[]): EnemyDoTState[] => {
    const byKey = new Map<string, EnemyDoTState>();
    for (const d of dots) {
        const key = `${d.type}-${d.tier}`;
        const existing = byKey.get(key);
        if (existing) existing.stacks += d.stacks;
        else byKey.set(key, { ...d });
    }
    return Array.from(byKey.values());
};

interface RoundStatusPanelProps {
    /** Per-config sections — one per healer config, mirroring DPSBuffPanel's `ships`. Each carries
     *  the config's display name (+ optional line colour) and the hovered round's data (or null). */
    configs: Array<{
        name: string;
        color?: string;
        roundData: HealingRoundData | null;
    }>;
    /** Total rounds simulated — shown in the header ("Round X of Y"). */
    totalRounds: number;
    /** 1-based hovered round number, or null. Gates the panel content. */
    hoveredRound: number | null;
    /** Resolves an enemy attacker's id to its display name (ship name or its manual label,
     *  e.g. "Enemy 1"). Falls back to the raw id if the lookup is missing. */
    enemyName: (enemyId: string) => string;
    /** Display name for the heal target, used as the Heal Target sub-section header. Falls back
     *  to "Heal Target" when not provided. */
    healTargetName?: string;
}

/** One healer config's block: the healer's OWN active self-buffs this round (the focus healer's
 *  scheduled + ability-granted buffs), followed by the enemy attackers' effects — each enemy that
 *  acted gets a sub-header (its ship name / manual label) with its own self-buffs and the
 *  debuffs/DoTs it landed on the heal target. */
const ConfigSection: React.FC<{
    name: string;
    color?: string;
    roundData: HealingRoundData | null;
    enemyName: (enemyId: string) => string;
    healTargetName: string;
}> = ({ name, color, roundData, enemyName, healTargetName }) => {
    const selfBuffs = (roundData?.activeSelfBuffs ?? []).filter(
        (b) => b.stacks === undefined || b.stacks > 0
    );
    const enemyEffects = (roundData?.enemyEffects ?? []).filter(
        (e) =>
            e.selfBuffs.length > 0 ||
            e.debuffs.length > 0 ||
            e.dots.length > 0 ||
            e.resistedDebuffs.length > 0 ||
            e.resistedDots.length > 0
    );
    // Heal Target section: the target's OWN active buffs (Cheat Death, Barrier, etc.) plus the
    // debuffs/DoTs on it AGGREGATED across every enemy for a target-centric view, then DEDUPED/
    // MERGED (debuffs by name, DoTs by type+tier summing stacks) so a debuff/DoT landed by two
    // enemies surfaces as ONE row here — the per-enemy attribution above stays intact. Names only.
    const targetBuffs = (roundData?.healTargetBuffs ?? []).filter(
        (b) => b.stacks === undefined || b.stacks > 0
    );
    const targetDebuffs = mergeTargetDebuffs(
        (roundData?.enemyEffects ?? []).flatMap((e) => e.debuffs)
    );
    const targetDots = mergeTargetDots((roundData?.enemyEffects ?? []).flatMap((e) => e.dots));
    const hasTargetSection =
        targetBuffs.length > 0 || targetDebuffs.length > 0 || targetDots.length > 0;
    const isEmpty = selfBuffs.length === 0 && enemyEffects.length === 0 && !hasTargetSection;

    return (
        <div className="px-2.5 py-2 border-b border-dark-border last:border-b-0">
            <div
                className="text-xs font-semibold uppercase tracking-wide mb-1.5"
                style={color ? { color } : undefined}
            >
                {name}
            </div>
            {isEmpty ? (
                <p className="text-xs text-dark-border italic">No buffs or effects this round</p>
            ) : (
                <>
                    {selfBuffs.length > 0 && (
                        <div className="mb-2">
                            <div className="text-xs text-theme-text-secondary mb-1">Buffs</div>
                            {selfBuffs.map((b, j) => (
                                <BuffRow key={`hself-${b.buffName}-${j}`} buff={b} variant="self" />
                            ))}
                        </div>
                    )}
                    {hasTargetSection && (
                        <div className="mb-2 last:mb-0">
                            <div className="text-xs font-semibold text-theme-text-primary mb-1">
                                {healTargetName}
                            </div>
                            {targetBuffs.length > 0 && (
                                <>
                                    <div className="text-xs text-theme-text-secondary mb-1">
                                        Buffs
                                    </div>
                                    {targetBuffs.map((b, j) => (
                                        <BuffRow
                                            key={`tbuff-${b.buffName}-${j}`}
                                            buff={b}
                                            variant="self"
                                        />
                                    ))}
                                </>
                            )}
                            {targetDebuffs.length > 0 && (
                                <>
                                    <div className="text-xs text-theme-text-secondary mt-1 mb-1">
                                        Debuffs
                                    </div>
                                    {targetDebuffs.map((b, j) => (
                                        <BuffRow
                                            key={`tagg-deb-${b.buffName}-${j}`}
                                            buff={b}
                                            variant="enemy"
                                        />
                                    ))}
                                </>
                            )}
                            {targetDots.length > 0 && (
                                <>
                                    <div className="text-xs text-theme-text-secondary mt-1 mb-1">
                                        DoTs
                                    </div>
                                    {targetDots.map((dot, j) => (
                                        <DotRow
                                            key={`tagg-dot-${dot.type}-${dot.tier}-${j}`}
                                            dot={dot}
                                        />
                                    ))}
                                </>
                            )}
                        </div>
                    )}
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
                            {(enemy.resistedDebuffs.length > 0 ||
                                enemy.resistedDots.length > 0) && (
                                <>
                                    <div className="text-xs text-theme-text-secondary mt-1 mb-1">
                                        Resisted
                                    </div>
                                    {enemy.resistedDebuffs.map((b, j) => (
                                        <BuffRow
                                            key={`tres-${b.buffName}-${j}`}
                                            buff={b}
                                            variant="enemy"
                                            resisted
                                        />
                                    ))}
                                    {enemy.resistedDots.map((dot, j) => (
                                        <DotRow
                                            key={`tresdot-${dot.type}-${dot.tier}-${j}`}
                                            dot={dot}
                                            resisted
                                        />
                                    ))}
                                </>
                            )}
                            {enemy.dots.length > 0 && (
                                <>
                                    <div className="text-xs text-theme-text-secondary mt-1 mb-1">
                                        DoTs on Target
                                    </div>
                                    {enemy.dots.map((dot, j) => (
                                        <DotRow
                                            key={`tdot-${dot.type}-${dot.tier}-${j}`}
                                            dot={dot}
                                        />
                                    ))}
                                </>
                            )}
                        </div>
                    ))}
                </>
            )}
        </div>
    );
};

/**
 * Right-hand hover-gated per-config round status panel, grouped PER HEALER CONFIG (each config gets
 * a section). Within each config it shows the healer's OWN active self-buffs this round (a "Buffs"
 * sub-section — mirrors how the DPS calculator's buff panel surfaces each attacker's self-buffs),
 * then the enemy attackers' effects ATTRIBUTED to the source enemy ship: each enemy that acted gets
 * a sub-header (its ship name / manual label) with its own self-buffs and the debuffs/DoTs it
 * landed on the heal target. Mirrors the DPS calculator's DPSBuffPanel structure — single round,
 * gated on `hoveredRound`, one section per config. Reuses the shared BuffRow status primitive.
 * Names only — never folded into any sim value.
 */
export const RoundStatusPanel: React.FC<RoundStatusPanelProps> = ({
    configs,
    totalRounds,
    hoveredRound,
    enemyName,
    healTargetName = 'Heal Target',
}) => (
    <div className="w-48 flex-shrink-0 card !p-0 rounded overflow-hidden">
        <div className="bg-dark-lighter px-2.5 py-1.5 text-xs font-semibold text-theme-text-secondary uppercase tracking-wide">
            {hoveredRound != null ? `Round ${hoveredRound} of ${totalRounds}` : 'Hover a round'}
        </div>
        {hoveredRound == null ? (
            <div className="px-2.5 py-2">
                <p className="text-xs text-dark-border italic">
                    Hover a round to see buffs and effects
                </p>
            </div>
        ) : (
            configs.map((config, i) => (
                <ConfigSection
                    key={i}
                    name={config.name}
                    color={config.color}
                    roundData={config.roundData}
                    enemyName={enemyName}
                    healTargetName={healTargetName}
                />
            ))
        )}
    </div>
);
