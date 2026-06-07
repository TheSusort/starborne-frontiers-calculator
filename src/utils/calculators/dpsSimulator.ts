import {
    ChargeGain,
    ConditionalDamage,
    DoTApplicationConfig,
    DoTApplicationEntry,
    EnemyBaseClass,
    SecondaryDamage,
    SelectedGameBuff,
    TeamActorInput,
} from '../../types/calculator';
import { ShipSkills } from '../../types/abilities';
import { AffinityName } from '../../types/ship';
import type { ActiveBuff } from '../combat/statusEngine';
import { runCombat, TeamActorEngineInput } from '../combat/engine';
import type { CombatEventBus } from '../combat/events';
import { flatInputToAbilities } from '../abilities/flatInputToAbilities';
import { selectFiringSkill } from '../abilities/applyAbilities';
import { toDotAndPenModifiers } from './dpsBuffHelpers';
import { computeAffinityModifiers } from './affinityUtils';

// Re-exported so existing importers (e.g. RoundData consumers) keep a single home.
export type { ActiveBuff } from '../combat/statusEngine';

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
    /** Enemy affinity — vs each walked team actor's affinity yields that actor's own
     *  damage/crit modifiers (computeAffinityModifiers). Absent → neutral defaults. The
     *  attacker's affinity matchup is still passed pre-resolved via affinityDamageModifier
     *  etc. (the page resolves it); this feeds the walked team actors. */
    enemyAffinity?: AffinityName;
    /** Attacker turn-order speed. Default 100. */
    speed?: number;
    /** Enemy turn-order speed. Default 50 — the enemy acts last at default speeds. */
    enemySpeed?: number;
    /** Skill model. When omitted, derived from the flat fields via flatInputToAbilities. */
    shipSkills?: ShipSkills;
    /** Team ships as real speed-ordered actors (Phase 2). When present, their buffs enter
     *  the sim HERE — keyed to their own turns. Do NOT also merge them into selfBuffs/
     *  enemyDebuffs (no-double-count). */
    teamActors?: TeamActorInput[];
    /** Optional emit-only event tap forwarded to the combat engine. Listeners must not
     *  read or mutate combat state (Phase 3 contract). */
    bus?: CombatEventBus;
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
    /** All-channel non-focus player (team) damage this round: direct (incl. its
     *  secondary/conditional components), DoT ticks from entries team actors applied, and
     *  detonation bursts from their bombs/accumulators. `totalRoundDamage + teamDamage` =
     *  the round's enemy-HP delta by construction. Set ONLY when walked team actors exist;
     *  undefined on legacy/attacker-only runs (legacy RoundData shape preserved). */
    teamDamage?: number;
    /** Number of EXTRA focus-actor turns this round (extra actions). Set only when
     *  ≥ 1 — undefined preserves the legacy RoundData shape (golden snapshots). */
    extraTurns?: number;
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
    /** Total non-focus player (team) damage across all rounds. Present only when walked
     *  team actors exist; the focus-only DPS fields above are unaffected by team damage. */
    teamTotalDamage?: number;
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
 * Per-walked-team-actor engine-input derivation, shared by the DPS and healing adapters.
 * For each team actor carrying shipSkills (and stats), resolve its OWN rates exactly as the
 * attacker's are resolved — landing chance from ITS hacking vs the enemy security with ITS
 * affinity damage modifier, and affinity damage/crit modifiers from ITS affinity vs the enemy.
 * The walked actor's selfDotModifier/defensePenetrationBuff start at 0 (its walked statuses
 * produce those in-loop). A legacy team actor (no shipSkills/stats) passes through unchanged.
 *
 * `healModifier` is intentionally NOT threaded: TeamActorInput.stats is a CombatStatBlock,
 * which carries no healModifier — so walked team actors heal at modifier 0 (the engine's
 * walk-bundle default). Widening CombatStatBlock is out of scope for this seam.
 *
 * Returns undefined when `teamActors` is undefined (preserves the DPS-path shape).
 */
export function deriveTeamEngineActors(
    teamActors: TeamActorInput[] | undefined,
    enemySecurity: number,
    enemyAffinity: AffinityName | undefined
): TeamActorEngineInput[] | undefined {
    return teamActors?.map((t) => {
        if (!t.shipSkills || !t.stats) return t;
        const aff = computeAffinityModifiers(t.affinity, enemyAffinity);
        const teamEffectiveHacking = t.stats.hacking * (1 + aff.damageModifier / 100);
        const teamLandingChance =
            Math.min(100, Math.max(0, teamEffectiveHacking - enemySecurity)) / 100;
        const teamCharged = selectFiringSkill(t.shipSkills, 'charged');
        const teamHasChargedSkill = t.chargeCount >= 1 && (teamCharged?.abilities.length ?? 0) > 0;
        return {
            ...t,
            walk: {
                shipSkills: t.shipSkills,
                stats: t.stats,
                debuffLandingChance: teamLandingChance,
                selfDotModifier: 0,
                defensePenetrationBuff: 0,
                affinityDamageModifier: aff.damageModifier,
                affinityCritCap: aff.critCap,
                affinityCritPenalty: aff.critPenalty,
                hasChargedSkill: teamHasChargedSkill,
            },
        };
    });
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
        speed,
        enemySpeed,
        teamActors,
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
    const chargedSkill = selectFiringSkill(shipSkills, 'charged');
    // A charged skill "exists" when the slot carries ANY ability — damage or pure
    // utility (buffs/debuffs). Utility charged skills bank charges and fire
    // zero-damage charged turns whose statuses apply (spec: hasChargedSkill widening).
    const hasChargedSkill = chargeCount >= 1 && (chargedSkill?.abilities.length ?? 0) > 0;

    // Per-walked-team-actor derivation (Task 4), extracted into a shared helper so the
    // healing adapter reuses byte-identical walk logic (goldens prove the extraction is
    // behaviour-preserving).
    const engineTeamActors = deriveTeamEngineActors(teamActors, enemySecurity, input.enemyAffinity);
    const hasWalkedTeam = !!engineTeamActors?.some((t) => t.walk);

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
        speed,
        enemySpeed,
        teamActors: engineTeamActors,
        bus: input.bus,
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
            // Team total only when any walked team actor exists (legacy shape preserved).
            ...(hasWalkedTeam ? { teamTotalDamage: Math.round(rawTotals.teamTotal) } : {}),
        },
    };
}
