import { ShipSkills } from '../../types/abilities';
import { SelectedGameBuff, TeamActorInput } from '../../types/calculator';
import { AffinityName } from '../../types/ship';
import type { ActiveBuff } from '../combat/statusEngine';
import type { CombatEventBus } from '../combat/events';
import { runCombat, EnemyRoundEffects } from '../combat/engine';
import { selectFiringSkill } from '../abilities/applyAbilities';
import { computeAffinityModifiers } from './affinityUtils';
import { toDotAndPenModifiers } from './dpsBuffHelpers';
import { deriveTeamEngineActors } from './dpsSimulator';

export interface HealerStats {
    hp: number;
    attack: number;
    defence: number;
    crit: number;
    critDamage: number;
    defensePenetration: number;
    healModifier: number;
    hacking: number;
    speed: number;
}

export interface EnemyAttackerInput {
    id: string;
    stats: { attack: number; crit: number; critDamage: number; speed: number };
    chargeCount: number;
    startCharged: boolean;
    /** Full kit walk. Absent → one synthesized basic attack per turn. */
    shipSkills?: ShipSkills;
    /** Enemy attacker's affinity. Combined with the heal target's affinity via
     *  computeAffinityModifiers(enemyAffinity, targetAffinity) to produce the matchup.
     *  Absent → neutral defaults (modifier 0, cap 100, penalty 0). */
    affinity?: AffinityName;
}

export interface HealingSimulationInput {
    healer: HealerStats;
    chargeCount: number;
    startCharged?: boolean;
    shipSkills: ShipSkills;
    selfBuffs: SelectedGameBuff[];
    /** Which player actor the enemies bombard: 'healer' or a team actor id. */
    healTargetId: string;
    /** Affinity of the heal target — used to compute each enemy attacker's matchup via
     *  computeAffinityModifiers(enemyAffinity, targetAffinity). Absent → neutral for all
     *  enemies (byte-identical to prior behaviour when enemy affinity was also absent). */
    healTargetAffinity?: AffinityName;
    teamActors?: TeamActorInput[];
    enemies: EnemyAttackerInput[];
    rounds: number;
    /** Optional emit-only event tap (write-only listeners). */
    bus?: CombatEventBus;
}

export interface HealingRoundData {
    round: number;
    action: 'active' | 'charged';
    charges: number;
    chargeCount: number;
    didCrit: boolean;
    directHeal: number;
    hotHeal: number;
    shield: number;
    cleanseCount: number;
    effectiveHealing: number;
    overheal: number;
    incomingDamage: number;
    shieldAbsorbed: number;
    targetHpPct: number; // ENTERING the round
    targetShieldPool: number; // ENTERING the round
    totalRoundHealing: number; // directHeal + hotHeal (raw; shield separate)
    cumulativeHealing: number;
    teamHealing?: number; // non-focus actors' raw (direct+HoT) healing; only when team actors exist
    activeSelfBuffs: ActiveBuff[];
    /** The HEAL TARGET's OWN active self-buffs this round (Cheat Death, Everliving Regeneration,
     *  Barrier, etc.) — captured comprehensively from the target's turn (PlayerTurnResult.
     *  activeSelfBuffs), so recurring/always-active buffs are included. Empty when there is no
     *  heal target, the target never acted, or the target is destroyed. NAMES ONLY for the
     *  round-overview panel — never folded into any heal value. */
    healTargetBuffs: ActiveBuff[];
    /** Per-enemy effects this round (Task 10a) — one entry per enemy attacker that produced an
     *  effect, carrying its own self-buffs + the debuffs it landed on the heal target, keyed by
     *  the enemy's actor id. For the UI's enemy-effects round overview, grouped/attributed to the
     *  source enemy ship. Empty for a bare/manual enemy with no effects. */
    enemyEffects: EnemyRoundEffects[];
    extraTurns?: number;
}

export interface HealingSimulationResult {
    rounds: HealingRoundData[];
    summary: {
        totalHealing: number; // RAW (direct + HoT), focus actor
        totalDirectHeal: number;
        totalHotHeal: number;
        totalShield: number;
        totalCleanses: number;
        totalEffectiveHealing: number;
        totalOverheal: number;
        totalShieldAbsorbed: number;
        totalIncomingDamage: number;
        /** RAW healing / rounds — NOT effective. */
        avgHealingPerRound: number;
        destroyedRound?: number; // present only if the target died
        teamTotalHealing?: number;
    };
}

/** The engine's internal focus actor id. */
const FOCUS_ID = 'attacker';

/**
 * Thin adapter over the combat engine (`src/utils/combat/engine.ts`) running in HEALING
 * mode. Mirrors `simulateDPS`: it derives the engine's input from the public healing input —
 * the heal-target id mapping, the debuff landing chance (hacking vs a fixed dummy security),
 * the static defPen/dot self-buff fold, the charged-skill widening, and the per-team-actor
 * walk (shared `deriveTeamEngineActors`) — then calls `runCombat` and assembles the public
 * result from the additive `healing` block.
 *
 * Enemy affinity IS resolved per attacker via computeAffinityModifiers(enemyAffinity,
 * healTargetAffinity) (the enemy is the attacker, the heal target the defender) — producing
 * each enemy's affinityDamageModifier / affinityCritCap / affinityCritPenalty. Absent enemy
 * or target affinity → neutral (modifier 0, cap 100, penalty 0). The HEALER's own offense vs
 * the dummy enemy still passes affinityDamageModifier 0 / cap 100 / penalty 0 (its damage is
 * irrelevant to healing), and the team walk is derived with no enemy affinity. The dummy enemy
 * is a pure DoT carrier / player-offense target (enemySpeed 0 →
 * it acts last) — player offense vs it is irrelevant to healing output, but the cadence and
 * DoT machinery still run as in DPS mode.
 *
 * Rounding: every healing number is rounded with Math.round (mirroring RoundData's damage
 * rounding). Raws are accumulated UNROUNDED and rounded LAST — per-row summed buckets and the
 * cumulative/summary totals round once at the point of presentation, avoiding drift.
 */
export function simulateHealing(input: HealingSimulationInput): HealingSimulationResult {
    const {
        healer,
        chargeCount,
        shipSkills,
        selfBuffs,
        enemies,
        rounds: numRounds,
        teamActors,
        healTargetAffinity,
    } = input;

    // Dummy-enemy defaults: a high-defence, huge-HP punching bag that never dies and acts last.
    const ENEMY_DEFENSE = 10000;
    const ENEMY_HP = 1_000_000;
    const ENEMY_SECURITY = 100;

    // Landing chance from the healer's hacking vs the dummy's security (no affinity this
    // increment): clamp(hacking − 100, 0, 100) / 100.
    const debuffLandingChance = Math.min(100, Math.max(0, healer.hacking - ENEMY_SECURITY)) / 100;

    // Self-side static folds (defPen / dot from self-buffs) — same discipline as simulateDPS.
    const { defensePenetrationBuff, dotDamageModifier: selfDotModifier } = toDotAndPenModifiers(
        selfBuffs,
        []
    );

    // hasChargedSkill widening: chargeCount >= 1 AND the charged slot carries ANY ability.
    const chargedSkill = selectFiringSkill(shipSkills, 'charged');
    const hasChargedSkill = chargeCount >= 1 && (chargedSkill?.abilities.length ?? 0) > 0;

    // Heal-target id mapping: 'healer' → the engine's focus id; otherwise pass through (must be
    // a team actor id — the engine throws on an unknown id, which we let propagate).
    const healTargetId = input.healTargetId === 'healer' ? FOCUS_ID : input.healTargetId;

    // Walked team actors via the shared helper (security 100, no enemy affinity — the
    // player team's affinity matchup vs the dummy punching-bag enemy is irrelevant to
    // healing output). healModifier IS threaded from CombatStatBlock.healModifier
    // (default 0 when absent), so walked team actors fold their own heal-modifier into heal casts.
    const engineTeamActors = deriveTeamEngineActors(teamActors, ENEMY_SECURITY, undefined);
    const hasTeamActors = !!teamActors && teamActors.length > 0;

    // Pre-resolve each enemy attacker's affinity matchup vs the heal target (Task 9).
    // Argument order: computeAffinityModifiers(ATTACKER affinity, DEFENDER affinity) —
    // the enemy is the attacker and the heal target is the defender.
    // Absent enemy or target affinity → neutral (damageMod 0, cap 100, penalty 0):
    // byte-identical to prior behaviour for all fixtures that omit affinity.
    const engineEnemyAttackers = enemies.map((e) => {
        const aff = computeAffinityModifiers(e.affinity, healTargetAffinity);
        return {
            ...e,
            affinityDamageModifier: aff.damageModifier,
            affinityCritCap: aff.critCap,
            affinityCritPenalty: aff.critPenalty,
        };
    });

    const { rounds: engineRounds, healing } = runCombat({
        attack: healer.attack,
        crit: healer.crit,
        critDamage: healer.critDamage,
        defensePenetration: healer.defensePenetration,
        chargeCount,
        shipSkills,
        enemyDefense: ENEMY_DEFENSE,
        enemyHp: ENEMY_HP,
        numRounds,
        selfBuffs,
        enemyDebuffs: [],
        debuffLandingChance,
        selfDotModifier,
        defensePenetrationBuff,
        hasChargedSkill,
        startCharged: input.startCharged ?? false,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        defence: healer.defence,
        hp: healer.hp,
        speed: healer.speed,
        enemySpeed: 0,
        healModifier: healer.healModifier,
        healTargetId,
        enemyAttackers: engineEnemyAttackers,
        teamActors: engineTeamActors,
        bus: input.bus,
    });

    // healing is always present (healTargetId is always set in this adapter), but guard anyway.
    const healingRounds = healing?.rounds ?? [];

    // Raw (unrounded) accumulators — rounded once at presentation (per row / summary).
    let cumulativeRaw = 0;
    let totalDirectRaw = 0;
    let totalHotRaw = 0;
    let totalShieldRaw = 0;
    let totalCleansesRaw = 0;
    let totalEffectiveRaw = 0;
    let totalOverhealRaw = 0;
    let totalShieldAbsorbedRaw = 0;
    let totalIncomingRaw = 0;
    let totalTeamRaw = 0;

    const rows: HealingRoundData[] = engineRounds.map((rd, i) => {
        const hr = healingRounds[i];
        const focus = hr?.perActor.get(FOCUS_ID);
        const directHealRaw = focus?.directHeal ?? 0;
        const hotHealRaw = focus?.hotHeal ?? 0;
        const shieldRaw = focus?.shield ?? 0;
        const cleanseRaw = focus?.cleanseCount ?? 0;
        const effectiveRaw = focus?.effectiveHeal ?? 0;
        const overhealRaw = focus?.overheal ?? 0;
        const incomingRaw = hr?.incomingDamage ?? 0;
        const shieldAbsorbedRaw = hr?.shieldAbsorbed ?? 0;

        // teamHealing = Σ non-focus entries' raw (direct + HoT). Team shield contributes to the
        // pool mechanically (the engine consumes it) but is NOT separately reported here.
        let teamRoundRaw = 0;
        if (hr) {
            for (const [id, h] of hr.perActor) {
                if (id === FOCUS_ID) continue;
                teamRoundRaw += h.directHeal + h.hotHeal;
            }
        }

        // Round the per-round raws AFTER summing (totalRoundHealing = directHeal + hotHeal raw,
        // rounded last). cumulativeRaw accumulates the unrounded direct+HoT raw, rounded per row.
        const totalRoundRaw = directHealRaw + hotHealRaw;
        cumulativeRaw += totalRoundRaw;

        totalDirectRaw += directHealRaw;
        totalHotRaw += hotHealRaw;
        totalShieldRaw += shieldRaw;
        totalCleansesRaw += cleanseRaw;
        totalEffectiveRaw += effectiveRaw;
        totalOverhealRaw += overhealRaw;
        totalShieldAbsorbedRaw += shieldAbsorbedRaw;
        totalIncomingRaw += incomingRaw;
        totalTeamRaw += teamRoundRaw;

        return {
            round: rd.round,
            action: rd.action,
            charges: rd.charges,
            chargeCount: rd.chargeCount,
            didCrit: rd.didCrit,
            directHeal: Math.round(directHealRaw),
            hotHeal: Math.round(hotHealRaw),
            shield: Math.round(shieldRaw),
            cleanseCount: Math.round(cleanseRaw),
            effectiveHealing: Math.round(effectiveRaw),
            overheal: Math.round(overhealRaw),
            incomingDamage: Math.round(incomingRaw),
            shieldAbsorbed: Math.round(shieldAbsorbedRaw),
            targetHpPct: Math.round(hr?.targetHpPctStart ?? 100),
            targetShieldPool: Math.round(hr?.targetShieldStart ?? 0),
            totalRoundHealing: Math.round(totalRoundRaw),
            cumulativeHealing: Math.round(cumulativeRaw),
            ...(hasTeamActors ? { teamHealing: Math.round(teamRoundRaw) } : {}),
            activeSelfBuffs: rd.activeSelfBuffs,
            // Heal-target's OWN active buffs this round (Cheat Death, Everliving Regen, Barrier,
            // etc.), captured from the target's turn in the engine. Names only — never folded
            // into any heal value. Default [] when absent (DPS mode / no heal target).
            healTargetBuffs: hr?.healTargetBuffs ?? [],
            // Enemy-effects overview (Task 10a): per-enemy, attributed by enemy id. Names only,
            // never folded into any value.
            enemyEffects: hr?.enemyEffects ?? [],
            ...(rd.extraTurns !== undefined ? { extraTurns: rd.extraTurns } : {}),
        };
    });

    return {
        rounds: rows,
        summary: {
            totalHealing: Math.round(totalDirectRaw + totalHotRaw),
            totalDirectHeal: Math.round(totalDirectRaw),
            totalHotHeal: Math.round(totalHotRaw),
            totalShield: Math.round(totalShieldRaw),
            totalCleanses: Math.round(totalCleansesRaw),
            totalEffectiveHealing: Math.round(totalEffectiveRaw),
            totalOverheal: Math.round(totalOverhealRaw),
            totalShieldAbsorbed: Math.round(totalShieldAbsorbedRaw),
            totalIncomingDamage: Math.round(totalIncomingRaw),
            avgHealingPerRound:
                numRounds > 0 ? Math.round((totalDirectRaw + totalHotRaw) / numRounds) : 0,
            ...(healing?.destroyedRound !== undefined
                ? { destroyedRound: healing.destroyedRound }
                : {}),
            ...(hasTeamActors ? { teamTotalHealing: Math.round(totalTeamRaw) } : {}),
        },
    };
}
