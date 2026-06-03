import {
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
import { selectFiringSkill, damageInputsFromSkill } from '../abilities/applyAbilities';
import { toDotAndPenModifiers } from './dpsBuffHelpers';
import { runCombat } from '../combat/engine';

// Re-exported so existing importers (e.g. RoundData consumers) keep a single home.
export type { ActiveBuff } from '../combat/statusEngine';
import type { ActiveBuff } from '../combat/statusEngine';

export interface DPSSimulationInput {
    attack: number;
    crit: number;
    critDamage: number;
    defensePenetration: number;
    // Flat damage fields are only read by the flatInputToAbilities fallback (when
    // `shipSkills` is omitted). Callers that pass `shipSkills` (the DPS page) skip them.
    activeMultiplier?: number;
    chargedMultiplier?: number;
    chargeCount: number;
    activeDoTs?: DoTApplicationConfig;
    chargedDoTs?: DoTApplicationConfig;
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
    /** This round's deterministic binary crit outcome (per-stream schedule). */
    didCrit: boolean;
    /** Enemy HP% ENTERING this round (100 → 0), derived from cumulative damage vs the
     *  enemy HP pool — the value hp-threshold conditions are gated against. */
    enemyHpPct: number;
    directDamage: number;
    corrosionDamage: number;
    infernoDamage: number;
    /** Detonation damage this round: Bomb detonations + DoT detonations (game-categorised together). */
    detonationDamage: number;
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
    totalDetonationDamage: number;
    totalSecondaryDamage: number;
    totalConditionalDamage: number;
}

export interface DPSSimulationResult {
    rounds: RoundData[];
    summary: DPSSimulationSummary;
}

export interface ActiveDoTState {
    type: 'corrosion' | 'inferno' | 'bomb';
    tier: number;
    stacks: number;
    ticksRemaining: number;
}

/**
 * Thin adapter over the combat engine (`src/utils/combat/engine.ts`). This derives
 * the engine's input from the public DPS input — landing chance, the static
 * defPen/dot self-buff fold, the flat-fields fallback, and the charged-skill check —
 * then calls `runCombat` and builds the summary. The per-round simulation itself
 * lives in the engine (relocated from the former `runSinglePass`).
 */
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

    const { rounds, rawTotals } = runCombat({
        attack,
        crit,
        critDamage,
        defensePenetration,
        chargeCount,
        shipSkills,
        enemyDefense,
        enemyHp,
        numRounds,
        selfBuffs,
        enemyDebuffs,
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
            totalDetonationDamage: Math.round(rawTotals.detonation),
            totalSecondaryDamage: Math.round(rawTotals.totalSecondary),
            totalConditionalDamage: Math.round(rawTotals.totalConditional),
        },
    };
}
