import { calculateCritMultiplier, calculateDamageReduction } from '../autogear/priorityScore';
import { evaluateCondition, scaledBonus } from '../abilities/evaluateConditions';
import { buildRoundContext } from '../abilities/roundContext';
import {
    Buff,
    ChargeGain,
    ConditionalDamage,
    DoTApplicationConfig,
    DoTApplicationEntry,
    EnemyBaseClass,
    SecondaryDamage,
    SelectedGameBuff,
} from '../../types/calculator';
import { ShipSkills } from '../../types/abilities';
import { flatInputToAbilities } from '../abilities/flatInputToAbilities';
import {
    selectFiringSkill,
    damageInputsFromSkill,
    secondaryFromSkill,
    dotsFromSkill,
    chargeAbilitiesFromSkill,
    modifierTotalsFromAbilities,
} from '../abilities/applyAbilities';
import {
    toSimBuffs,
    toEnemyModifiers,
    toDotAndPenModifiers,
    toEnemyDotModifier,
} from './dpsBuffHelpers';
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
    /** Attacker hacking stat. Landing chance = clamp(hacking - enemySecurity, 0, 100) / 100. Default 200. */
    hacking?: number;
    /** Defender security stat. Default 100. */
    enemySecurity?: number;
    /** Source stat for Defense-based secondary damage. */
    defence?: number;
    /** Source stat for HP-based secondary damage. */
    hp?: number;
    /** Secondary damage applied on active-skill rounds. */
    activeSecondary?: SecondaryDamage;
    /** Secondary damage applied on charged-skill rounds. */
    chargedSecondary?: SecondaryDamage;
    /** Conditional scaling bonus applied on active-skill rounds. */
    activeConditional?: ConditionalDamage;
    /** Conditional scaling bonus applied on charged-skill rounds. */
    chargedConditional?: ConditionalDamage;
    /** Per-round self charge gain parsed from the attacker's skill text. */
    selfChargeGain?: ChargeGain;
    /** Flat extra charges per round contributed by allies/supporters. */
    allyChargePerRound?: number;
    /** Enemy base class, for the 'enemy-type' charge-gain condition. */
    enemyType?: EnemyBaseClass;
    /** Skill model. When omitted, derived from the flat fields via flatInputToAbilities. */
    shipSkills?: ShipSkills;
}

export interface RoundData {
    round: number;
    action: 'active' | 'charged';
    charges: number;
    /** Charges required to fire the charged skill; 0 when the ship has no charged skill. */
    chargeCount: number;
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
    resistedEnemyDebuffs: ActiveBuff[];
    appliedDoTs: DoTApplicationEntry[];
    dotsLanded: boolean;
    activeDoTStates: ActiveDoTState[];
}

export interface DPSSimulationSummary {
    totalDamage: number;
    avgDamagePerRound: number;
    totalDirectDamage: number;
    totalCorrosionDamage: number;
    totalInfernoDamage: number;
    totalBombDamage: number;
    totalSecondaryDamage: number;
    totalConditionalDamage: number;
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
    const defenceBuff = buffs
        .filter((b) => b.stat === 'defence')
        .reduce((sum, b) => sum + b.value, 0);
    const hpBuff = buffs.filter((b) => b.stat === 'hp').reduce((sum, b) => sum + b.value, 0);
    return { attackBuff, critBuff, critDamageBuff, outgoingDamageBuff, defenceBuff, hpBuff };
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

function runSinglePass(params: {
    attack: number;
    crit: number;
    critDamage: number;
    defensePenetration: number;
    chargeCount: number;
    shipSkills: ShipSkills;
    enemyDefense: number;
    enemyHp: number;
    numRounds: number;
    timeline: ReturnType<typeof computeBuffTimeline>;
    selfBuffLookup: Map<string, SelectedGameBuff[]>;
    enemyDebuffLookup: Map<string, SelectedGameBuff[]>;
    debuffLandingChance: number;
    selfDotModifier: number;
    defensePenetrationBuff: number;
    hasChargedSkill: boolean;
    startCharged: boolean;
    affinityDamageModifier: number;
    affinityCritCap: number;
    affinityCritPenalty: number;
    defence: number;
    hp: number;
    allyChargePerRound?: number;
    enemyType?: EnemyBaseClass;
}): {
    rounds: RoundData[];
    rawTotals: {
        direct: number;
        corrosion: number;
        inferno: number;
        bomb: number;
        cumulative: number;
        totalSecondary: number;
        totalConditional: number;
    };
} {
    const {
        attack,
        crit,
        critDamage,
        defensePenetration,
        chargeCount,
        shipSkills,
        enemyDefense,
        enemyHp,
        numRounds,
        timeline,
        selfBuffLookup,
        enemyDebuffLookup,
        debuffLandingChance,
        selfDotModifier,
        defensePenetrationBuff,
        hasChargedSkill,
        startCharged,
        affinityDamageModifier,
        affinityCritCap,
        affinityCritPenalty,
        defence,
        hp,
        allyChargePerRound,
        enemyType,
    } = params;

    // All mutable state declared fresh on every call
    let charges = startCharged ? chargeCount : 0;
    let cumulativeDamage = 0;
    let totalDirectRaw = 0;
    let totalCorrosionRaw = 0;
    let totalInfernoRaw = 0;
    let totalBombRaw = 0;
    let totalSecondaryRaw = 0;
    let totalConditionalRaw = 0;
    const corrosionEntries: ActiveDoTStack[] = [];
    const infernoEntries: ActiveDoTStack[] = [];
    const pendingBombs: PendingBomb[] = [];

    const roundData: RoundData[] = [];

    for (let r = 1; r <= numRounds; r++) {
        let action: 'active' | 'charged';

        if (hasChargedSkill && charges >= chargeCount) {
            action = 'charged';
            charges = 0;
        } else {
            action = 'active';
            if (hasChargedSkill) {
                charges += 1;
            }
        }

        // Read this round's damage shape from the firing skill's abilities.
        const firingSkill = selectFiringSkill(shipSkills, action);
        const {
            multiplier: rawMultiplier,
            hits,
            scalingAbility,
        } = damageInputsFromSkill(firingSkill);
        const effectiveMultiplier = rawMultiplier * hits;
        const secondary = secondaryFromSkill(firingSkill);
        const dotsConfig = dotsFromSkill(firingSkill);

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
        let { attackBuff, critBuff, critDamageBuff, outgoingDamageBuff, defenceBuff, hpBuff } =
            calculateBuffTotals(toSimBuffs(roundSelfBuffs));

        const roundDebuffLanded = Math.random() < debuffLandingChance;
        const landedEnemyDebuffs: ActiveBuff[] = [];
        const resistedEnemyDebuffs: ActiveBuff[] = [];
        const roundEnemyDebuffs = entry.activeEnemyDebuffs.flatMap((ab) => {
            if (!roundDebuffLanded) {
                resistedEnemyDebuffs.push(ab);
                return [];
            }
            landedEnemyDebuffs.push(ab);
            const bufs = enemyDebuffLookup.get(ab.buffName) ?? [];
            if (ab.stacks !== undefined) {
                return ab.stacks > 0 ? bufs.map((b) => ({ ...b, stacks: ab.stacks! })) : [];
            }
            return bufs;
        });
        const { enemyDefenseModifier, incomingDamageModifier } =
            toEnemyModifiers(roundEnemyDebuffs);

        // Effective crit rate from a given crit-buff total, clamped by affinity.
        const cappedCrit = (critBuffTotal: number) =>
            Math.min(affinityCritCap, Math.max(0, crit + critBuffTotal - affinityCritPenalty));

        // Fold active passive modifiers (firing skill + passive slot) into the round's
        // buff totals so they affect damage exactly like an equivalent buff. Folded here,
        // after enemy modifiers are known but before the effective-stat computations consume
        // the buff totals. The PRE-modifier crit estimate (cappedCrit(critBuff)) is used only
        // for the rare self-crit-gated modifier condition, avoiding a self-referential gate.
        const modifierCtx = buildRoundContext({
            selfBuffNames: entry.activeSelfBuffs
                .filter((ab) => ab.stacks === undefined || ab.stacks > 0)
                .map((ab) => ab.buffName),
            landedEnemyDebuffCount: landedEnemyDebuffs.length,
            corrosionEntryCount: corrosionEntries.length,
            infernoEntryCount: infernoEntries.length,
            bombCount: pendingBombs.length,
            effectiveCritRate: cappedCrit(critBuff),
            enemyType,
        });
        const passiveSkill = shipSkills.slots.find((s) => s.slot === 'passive');
        const modifierAbilities = [
            ...(firingSkill?.abilities ?? []),
            ...(passiveSkill?.abilities ?? []),
        ];
        const modTotals = modifierTotalsFromAbilities(modifierAbilities, modifierCtx);
        attackBuff += modTotals.attack;
        critBuff += modTotals.crit;
        critDamageBuff += modTotals.critDamage;
        outgoingDamageBuff += modTotals.outgoingDamage;
        defenceBuff += modTotals.defence;
        hpBuff += modTotals.hp;

        const effectiveAttack = attack * (1 + attackBuff / 100);
        const effectiveCrit = cappedCrit(critBuff);
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
        const enemyDotMod = toEnemyDotModifier(roundEnemyDebuffs);
        const dotMult = 1 + (selfDotModifier + enemyDotMod) / 100;
        const affinityMult = 1 + affinityDamageModifier / 100;
        const effectiveDefence = defence * (1 + defenceBuff / 100);
        const effectiveHp = hp * (1 + hpBuff / 100);
        let secondaryStatValue = 0;
        if (secondary) {
            const source = secondary.stat === 'defense' ? effectiveDefence : effectiveHp;
            secondaryStatValue = source * (secondary.pct / 100);
        }

        // Per-round condition context for the Phase 1 condition engine. Built once
        // after landedEnemyDebuffs and effectiveCrit are known, but BEFORE Step 3
        // applies this round's fresh DoTs — so derivable counts read pre-Step-3 state,
        // matching the prior inline behaviour.
        const ctx = buildRoundContext({
            selfBuffNames: entry.activeSelfBuffs
                .filter((ab) => ab.stacks === undefined || ab.stacks > 0)
                .map((ab) => ab.buffName),
            landedEnemyDebuffCount: landedEnemyDebuffs.length,
            corrosionEntryCount: corrosionEntries.length,
            infernoEntryCount: infernoEntries.length,
            bombCount: pendingBombs.length,
            effectiveCritRate: effectiveCrit,
            enemyType,
        });

        // Conditional scaling bonus, folded additively into the skill multiplier.
        // Read from the firing skill's damage ability's own scaling rule. Derivable
        // conditions read this round's sim state (pre-Step-3 DoT arrays, so this
        // round's freshly-applied DoTs are not yet counted); manual conditions use
        // a static count.
        const conditionalBonusPct = scalingAbility ? scaledBonus(scalingAbility, ctx) : 0;

        // Charge manipulation: charges only accumulate on ACTIVE rounds. A charged
        // round fires the charged skill, which consumes all charges (reset to 0 at
        // the top of the loop) — nothing banks toward the next charge on that round.
        // Self + ally gains are added here and the total is capped at chargeCount,
        // since charges never exceed what the charged skill requires.
        if (hasChargedSkill && action === 'active') {
            let bonusCharges = 0;
            for (const ability of chargeAbilitiesFromSkill(firingSkill)) {
                if (ability.config.type !== 'charge') continue;
                const cond = ability.conditions[0];
                const count = cond ? evaluateCondition(cond, ctx) : 1;
                bonusCharges += count * ability.config.amount;
            }
            charges = Math.min(charges + bonusCharges + (allyChargePerRound ?? 0), chargeCount);
        }

        const preCritDamage =
            effectiveAttack * ((effectiveMultiplier + conditionalBonusPct) / 100) +
            secondaryStatValue;
        const postDefenseFactor =
            critMultiplier *
            (1 - damageReduction / 100) *
            (1 + outgoingDamageBuff / 100) *
            (1 + incomingDamageModifier / 100) *
            affinityMult;
        const directDamage = preCritDamage * postDefenseFactor;
        const secondaryDamage = secondaryStatValue * postDefenseFactor;
        const conditionalDamage = effectiveAttack * (conditionalBonusPct / 100) * postDefenseFactor;

        // Step 3: Apply new DoT stacks from this round's skill (subject to landing roll)
        const dotsLanded = roundDebuffLanded;
        if (dotsLanded) {
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
        }

        // Step 4: Tick corrosion (scales with enemy HP, capped at 5000 dmg per 1%)
        const corrosionBaseHp = Math.min(enemyHp, 500_000);
        const corrosionDamage =
            tickDoTStacks(corrosionEntries, corrosionBaseHp) * dotMult * affinityMult;

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
        totalDirectRaw += directDamage;
        totalSecondaryRaw += secondaryDamage;
        totalConditionalRaw += conditionalDamage;
        totalCorrosionRaw += corrosionDamage;
        totalInfernoRaw += infernoDamage;
        totalBombRaw += bombDamage;

        // Report stacks after expiry (state going into next round)
        roundData.push({
            round: r,
            action,
            charges: Math.round(charges),
            chargeCount: hasChargedSkill ? chargeCount : 0,
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
            activeEnemyDebuffs: landedEnemyDebuffs,
            resistedEnemyDebuffs,
            appliedDoTs: dotsConfig,
            dotsLanded,
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
        rawTotals: {
            direct: totalDirectRaw,
            corrosion: totalCorrosionRaw,
            inferno: totalInfernoRaw,
            bomb: totalBombRaw,
            cumulative: cumulativeDamage,
            totalSecondary: totalSecondaryRaw,
            totalConditional: totalConditionalRaw,
        },
    };
}

export function simulateDPS(input: DPSSimulationInput): DPSSimulationResult {
    const {
        attack,
        crit,
        critDamage,
        defensePenetration,
        chargeCount,
        enemyDefense,
        enemyHp,
        rounds: numRounds,
        selfBuffs,
        enemyDebuffs,
        defence = 0,
        hp = 0,
        allyChargePerRound,
        enemyType,
    } = input;
    const { affinityDamageModifier = 0, affinityCritCap = 100, affinityCritPenalty = 0 } = input;

    // Compute debuff landing chance (affinity modifier applies multiplicatively to hacking)
    const hacking = input.hacking ?? 200;
    const enemySecurity = input.enemySecurity ?? 100;
    const effectiveHacking = hacking * (1 + affinityDamageModifier / 100);
    const debuffLandingChance = Math.min(100, Math.max(0, effectiveHacking - enemySecurity)) / 100;

    // Self-side constants (not subject to rolls)
    const { defensePenetrationBuff, dotDamageModifier: selfDotModifier } = toDotAndPenModifiers(
        selfBuffs,
        []
    );
    const shipSkills = input.shipSkills ?? flatInputToAbilities(input);
    const chargedDamage = damageInputsFromSkill(selectFiringSkill(shipSkills, 'charged'));
    const hasChargedSkill = chargeCount >= 1 && chargedDamage.multiplier > 0;

    // Pre-compute deterministic buff timeline
    const timeline = computeBuffTimeline(
        selfBuffs,
        enemyDebuffs,
        hasChargedSkill ? chargeCount : 0,
        input.startCharged ?? false,
        numRounds
    );

    // Build lookup maps
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

    const { rounds, rawTotals } = runSinglePass({
        attack,
        crit,
        critDamage,
        defensePenetration,
        chargeCount,
        shipSkills,
        enemyDefense,
        enemyHp,
        numRounds,
        timeline,
        selfBuffLookup,
        enemyDebuffLookup,
        debuffLandingChance,
        selfDotModifier,
        defensePenetrationBuff,
        hasChargedSkill,
        startCharged: input.startCharged ?? false,
        affinityDamageModifier,
        affinityCritCap,
        affinityCritPenalty,
        defence,
        hp,
        allyChargePerRound,
        enemyType,
    });

    const totalDamage = Math.round(rawTotals.cumulative);

    return {
        rounds,
        summary: {
            totalDamage,
            avgDamagePerRound: Math.round(rawTotals.cumulative / numRounds),
            totalDirectDamage: Math.round(rawTotals.direct),
            totalCorrosionDamage: Math.round(rawTotals.corrosion),
            totalInfernoDamage: Math.round(rawTotals.inferno),
            totalBombDamage: Math.round(rawTotals.bomb),
            totalSecondaryDamage: Math.round(rawTotals.totalSecondary),
            totalConditionalDamage: Math.round(rawTotals.totalConditional),
        },
    };
}
