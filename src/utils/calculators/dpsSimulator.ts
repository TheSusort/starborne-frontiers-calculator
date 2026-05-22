import { calculateCritMultiplier, calculateDamageReduction } from '../autogear/priorityScore';
import {
    Buff,
    DoTApplicationConfig,
    DoTApplicationEntry,
    SelectedGameBuff,
} from '../../types/calculator';
import { toSimBuffs, toEnemyModifiers, toDotAndPenModifiers } from './dpsBuffHelpers';
import { ActiveBuff, computeBuffTimeline } from './buffTimeline';

export interface DPSSimulationInput {
    attack: number;
    crit: number;
    critDamage: number;
    defensePenetration: number;
    activeMultiplier: number;
    chargedMultiplier: number;
    chargeCount: number;
    activeDoTs: DoTApplicationConfig;
    chargedDoTs: DoTApplicationConfig;
    enemyDefense: number;
    enemyHp: number;
    rounds: number;
    selfBuffs: SelectedGameBuff[];
    enemyDebuffs: SelectedGameBuff[];
    startCharged?: boolean;
    /** Percentage additive modifier from affinity (e.g. 25, -25, 0). Applied to all damage types. */
    affinityDamageModifier?: number;
    /** Hard ceiling on effective crit rate from affinity matchup (75 for disadvantage, 100 otherwise). */
    affinityCritCap?: number;
    /** Additive pp reduction on effective crit rate (25 for disadvantage, 0 otherwise). */
    affinityCritPenalty?: number;
}

export interface RoundData {
    round: number;
    action: 'active' | 'charged';
    charges: number;
    directDamage: number;
    corrosionDamage: number;
    infernoDamage: number;
    bombDamage: number;
    totalRoundDamage: number;
    cumulativeDamage: number;
    activeCorrosionStacks: number;
    activeInfernoStacks: number;
    activeBombCount: number;
    activeSelfBuffs: ActiveBuff[];
    activeEnemyDebuffs: ActiveBuff[];
    appliedDoTs: DoTApplicationEntry[];
    activeDoTStates: ActiveDoTState[];
}

export interface DPSSimulationSummary {
    totalDamage: number;
    avgDamagePerRound: number;
    totalDirectDamage: number;
    totalCorrosionDamage: number;
    totalInfernoDamage: number;
    totalBombDamage: number;
}

export interface DPSSimulationResult {
    rounds: RoundData[];
    summary: DPSSimulationSummary;
}

interface ActiveDoTStack {
    stacks: number;
    tier: number;
    remainingRounds: number;
}

interface PendingBomb {
    countdown: number;
    damagePerStack: number;
    stacks: number;
    tier: number;
}

export interface ActiveDoTState {
    type: 'corrosion' | 'inferno' | 'bomb';
    tier: number;
    stacks: number;
    ticksRemaining: number;
}

function calculateBuffTotals(buffs: Buff[]) {
    const attackBuff = buffs
        .filter((b) => b.stat === 'attack')
        .reduce((sum, b) => sum + b.value, 0);
    const critBuff = buffs.filter((b) => b.stat === 'crit').reduce((sum, b) => sum + b.value, 0);
    const critDamageBuff = buffs
        .filter((b) => b.stat === 'critDamage')
        .reduce((sum, b) => sum + b.value, 0);
    const outgoingDamageBuff = buffs
        .filter((b) => b.stat === 'outgoingDamage')
        .reduce((sum, b) => sum + b.value, 0);
    return { attackBuff, critBuff, critDamageBuff, outgoingDamageBuff };
}

function tickDoTStacks(entries: ActiveDoTStack[], baseValue: number): number {
    return entries.reduce((sum, e) => sum + e.stacks * (e.tier / 100) * baseValue, 0);
}

function totalStacks(entries: ActiveDoTStack[]): number {
    return entries.reduce((sum, e) => sum + e.stacks, 0);
}

function expireStacks(entries: ActiveDoTStack[]): void {
    for (let i = entries.length - 1; i >= 0; i--) {
        entries[i].remainingRounds -= 1;
        if (entries[i].remainingRounds <= 0) {
            entries.splice(i, 1);
        }
    }
}

export function simulateDPS(input: DPSSimulationInput): DPSSimulationResult {
    const {
        attack,
        crit,
        critDamage,
        defensePenetration,
        activeMultiplier,
        chargedMultiplier,
        chargeCount,
        activeDoTs,
        chargedDoTs,
        enemyDefense,
        enemyHp,
        rounds: numRounds,
        selfBuffs,
        enemyDebuffs,
    } = input;
    const { affinityDamageModifier = 0, affinityCritCap = 100, affinityCritPenalty = 0 } = input;

    const { defensePenetrationBuff, dotDamageModifier } = toDotAndPenModifiers(
        selfBuffs,
        enemyDebuffs
    );

    const hasChargedSkill = chargedMultiplier > 0 && chargeCount >= 1;

    // Pre-compute per-round timeline — pass 0 charges when charged skill never fires
    // to keep the buff timeline consistent with the damage simulation
    const timeline = computeBuffTimeline(
        selfBuffs,
        enemyDebuffs,
        hasChargedSkill ? chargeCount : 0,
        input.startCharged ?? false,
        numRounds
    );

    // Separate lookups prevent name collisions between self-buffs and enemy debuffs
    const selfBuffLookup = new Map<string, SelectedGameBuff[]>();
    for (const b of selfBuffs) {
        const existing = selfBuffLookup.get(b.buffName) ?? [];
        selfBuffLookup.set(b.buffName, [...existing, b]);
    }
    const enemyDebuffLookup = new Map<string, SelectedGameBuff[]>();
    for (const b of enemyDebuffs) {
        const existing = enemyDebuffLookup.get(b.buffName) ?? [];
        enemyDebuffLookup.set(b.buffName, [...existing, b]);
    }

    let charges = input.startCharged ? input.chargeCount : 0;
    let cumulativeDamage = 0;
    const corrosionEntries: ActiveDoTStack[] = [];
    const infernoEntries: ActiveDoTStack[] = [];
    const pendingBombs: PendingBomb[] = [];

    let totalDirectDamage = 0;
    let totalCorrosionDamage = 0;
    let totalInfernoDamage = 0;
    let totalBombDamage = 0;

    const roundData: RoundData[] = [];

    for (let r = 1; r <= numRounds; r++) {
        let action: 'active' | 'charged';
        let multiplier: number;
        let dotsConfig: DoTApplicationConfig;

        if (hasChargedSkill && charges >= chargeCount) {
            action = 'charged';
            multiplier = chargedMultiplier;
            dotsConfig = chargedDoTs;
            charges = 0;
        } else {
            action = 'active';
            multiplier = activeMultiplier;
            dotsConfig = activeDoTs;
            if (hasChargedSkill) {
                charges += 1;
            }
        }

        // Per-round buff totals from timeline
        const entry = timeline[r - 1];

        const roundSelfBuffs = entry.activeSelfBuffs.flatMap((ab) => {
            const bufs = selfBuffLookup.get(ab.buffName) ?? [];
            // Accumulating buff: override static stacks with per-round count; skip when 0
            if (ab.stacks !== undefined) {
                return ab.stacks > 0 ? bufs.map((b) => ({ ...b, stacks: ab.stacks! })) : [];
            }
            return bufs;
        });
        const { attackBuff, critBuff, critDamageBuff, outgoingDamageBuff } = calculateBuffTotals(
            toSimBuffs(roundSelfBuffs)
        );

        const roundEnemyDebuffs = entry.activeEnemyDebuffs.flatMap((ab) => {
            const bufs = enemyDebuffLookup.get(ab.buffName) ?? [];
            if (ab.stacks !== undefined) {
                return ab.stacks > 0 ? bufs.map((b) => ({ ...b, stacks: ab.stacks! })) : [];
            }
            return bufs;
        });
        const { enemyDefenseModifier, incomingDamageModifier } =
            toEnemyModifiers(roundEnemyDebuffs);

        const effectiveAttack = attack * (1 + attackBuff / 100);
        const effectiveCrit = Math.min(
            affinityCritCap,
            Math.max(0, crit + critBuff - affinityCritPenalty)
        );
        const effectiveCritDamage = critDamage + critDamageBuff;
        const critMultiplier = calculateCritMultiplier({
            attack: effectiveAttack,
            crit: effectiveCrit,
            critDamage: effectiveCritDamage,
            hp: 0,
            defence: 0,
            hacking: 0,
            security: 0,
            speed: 0,
            healModifier: 0,
        });
        const effectivePen = defensePenetration + defensePenetrationBuff;
        const effectiveDefense =
            enemyDefense * (1 + enemyDefenseModifier / 100) * (1 - effectivePen / 100);
        const damageReduction =
            effectiveDefense > 0 ? calculateDamageReduction(effectiveDefense) : 0;

        // Step 1: Calculate direct damage
        const dotMult = 1 + dotDamageModifier / 100;
        const affinityMult = 1 + affinityDamageModifier / 100;
        const baseDamage = effectiveAttack * critMultiplier * (1 - damageReduction / 100);
        const directDamage =
            baseDamage *
            (multiplier / 100) *
            (1 + outgoingDamageBuff / 100) *
            (1 + incomingDamageModifier / 100) *
            affinityMult;

        // Step 3: Apply new DoT stacks from this round's skill
        for (const dot of dotsConfig) {
            if (dot.stacks <= 0 || dot.tier <= 0) continue;
            if (dot.type === 'corrosion') {
                corrosionEntries.push({
                    stacks: dot.stacks,
                    tier: dot.tier,
                    remainingRounds: dot.duration,
                });
            } else if (dot.type === 'inferno') {
                infernoEntries.push({
                    stacks: dot.stacks,
                    tier: dot.tier,
                    remainingRounds: dot.duration,
                });
            } else if (dot.type === 'bomb') {
                pendingBombs.push({
                    countdown: Math.max(1, dot.duration),
                    damagePerStack: effectiveAttack * (dot.tier / 100),
                    stacks: dot.stacks,
                    tier: dot.tier,
                });
            }
        }

        // Step 4: Tick corrosion (scales with enemy HP)
        const corrosionDamage = tickDoTStacks(corrosionEntries, enemyHp) * dotMult * affinityMult;

        // Step 5: Tick inferno (scales with attacker's effective attack, no outgoing buff)
        const infernoDamage =
            tickDoTStacks(infernoEntries, effectiveAttack) * dotMult * affinityMult;

        // Expire DoT stacks after ticking
        expireStacks(corrosionEntries);
        expireStacks(infernoEntries);

        // Step 6: Process bombs
        let bombDamage = 0;
        for (let i = pendingBombs.length - 1; i >= 0; i--) {
            pendingBombs[i].countdown -= 1;
            if (pendingBombs[i].countdown <= 0) {
                bombDamage += pendingBombs[i].stacks * pendingBombs[i].damagePerStack;
                pendingBombs.splice(i, 1);
            }
        }
        bombDamage *= affinityMult;

        const totalRoundDamage = directDamage + corrosionDamage + infernoDamage + bombDamage;
        cumulativeDamage += totalRoundDamage;

        totalDirectDamage += directDamage;
        totalCorrosionDamage += corrosionDamage;
        totalInfernoDamage += infernoDamage;
        totalBombDamage += bombDamage;

        // Report stacks after expiry (state going into next round)
        roundData.push({
            round: r,
            action,
            charges,
            directDamage: Math.round(directDamage),
            corrosionDamage: Math.round(corrosionDamage),
            infernoDamage: Math.round(infernoDamage),
            bombDamage: Math.round(bombDamage),
            totalRoundDamage: Math.round(totalRoundDamage),
            cumulativeDamage: Math.round(cumulativeDamage),
            activeCorrosionStacks: totalStacks(corrosionEntries),
            activeInfernoStacks: totalStacks(infernoEntries),
            activeBombCount: pendingBombs.length,
            activeSelfBuffs: entry.activeSelfBuffs,
            activeEnemyDebuffs: entry.activeEnemyDebuffs,
            appliedDoTs: dotsConfig,
            activeDoTStates: [
                ...corrosionEntries.map((e) => ({
                    type: 'corrosion' as const,
                    tier: e.tier,
                    stacks: e.stacks,
                    ticksRemaining: e.remainingRounds,
                })),
                ...infernoEntries.map((e) => ({
                    type: 'inferno' as const,
                    tier: e.tier,
                    stacks: e.stacks,
                    ticksRemaining: e.remainingRounds,
                })),
                ...pendingBombs.map((b) => ({
                    type: 'bomb' as const,
                    tier: b.tier,
                    stacks: b.stacks,
                    ticksRemaining: b.countdown,
                })),
            ],
        });
    }

    return {
        rounds: roundData,
        summary: {
            totalDamage: Math.round(cumulativeDamage),
            avgDamagePerRound: Math.round(cumulativeDamage / numRounds),
            totalDirectDamage: Math.round(totalDirectDamage),
            totalCorrosionDamage: Math.round(totalCorrosionDamage),
            totalInfernoDamage: Math.round(totalInfernoDamage),
            totalBombDamage: Math.round(totalBombDamage),
        },
    };
}
